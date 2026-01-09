import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
const tcb = require("@cloudbase/node-sdk");
import { ResumeGenerator } from './resumeGenerator';
import { GeminiService } from './geminiService';
import { ResumeAIService } from './resumeAIService';
import { ResumeData, GenerateFromFrontendRequest, mapFrontendRequestToResumeData } from './types';

const app = express();
const generator = new ResumeGenerator();
const gemini = new GeminiService();
const aiService = new ResumeAIService();

// 1. 确定最终要连接的环境 ID (用于部署自检)
const FINAL_ENV_ID = process.env.CLOUD_ENV;
let tcbApp: any;

if (FINAL_ENV_ID) {
  tcbApp = tcb.init({
    env: FINAL_ENV_ID,
    secretId: process.env.SecretId,
    secretKey: process.env.SecretKey,
  });
}

// 配置 multer 用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req: express.Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // 只接受图片文件
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片文件'));
    }
  },
});

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * 将文件 Buffer 转换为 Base64 Data URL
 */
function bufferToDataURL(buffer: Buffer, mimeType: string): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * 生成简历 PDF API
 * POST /api/generate
 * 
 * 请求体支持两种格式：
 * 1. JSON 格式（推荐）：
 *    {
 *      "resumeData": { ... },
 *      "avatar": "https://example.com/avatar.jpg" 或 "data:image/jpeg;base64,..."
 *    }
 * 
 * 2. FormData 格式（支持文件上传）：
 *    - resumeData: JSON 字符串
 *    - avatar: 图片文件（可选）
 */
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

app.post('/api/generate', upload.single('avatar'), async (req: MulterRequest, res: Response) => {
  try {
    // [测试用] 打印接收到的数据，方便调试
    console.log('🚀 收到生成请求');
    
    // 如果是这种新结构，打印更详细的信息
    if (req.body.resume_profile && req.body.job_data) {
      const payload = req.body as GenerateFromFrontendRequest;
      console.log('👤 用户姓名:', payload.resume_profile.name);
      console.log('💼 岗位名称:', payload.job_data.title_chinese || payload.job_data.title);
      console.log('🤖 AI 指令:', payload.resume_profile.aiMessage);
    } else {
      console.log('📦 Body 内容 (常规结构):', JSON.stringify(req.body, null, 2));
    }

    if (req.file) {
      console.log('📷 收到上传文件:', req.file.originalname, '大小:', req.file.size);
    }

    let resumeData: ResumeData;
    let avatar: string | undefined;

    // 检查是否有文件上传 (Multer)
    if (req.file) {
      avatar = bufferToDataURL(req.file.buffer, req.file.mimetype);
    }

    // 1. 处理新的请求结构 (resume_profile + job_data)
    if (req.body.resume_profile && req.body.job_data) {
      const payload = req.body as GenerateFromFrontendRequest;
      // 调用 AI 增强服务
      resumeData = await aiService.enhance(payload);
    } else if (req.body.resumeData) {
      // 2. 处理原有的 JSON 结构
      if (typeof req.body.resumeData === 'string') {
        resumeData = JSON.parse(req.body.resumeData);
      } else {
        resumeData = req.body.resumeData;
      }
    } else {
      // 3. 处理直接的请求体
      resumeData = req.body;
    }

    // 优先使用文件上传的头像，其次是请求体中的头像，最后是 profile 里的 photo
    if (avatar) {
      resumeData.avatar = avatar;
    } else if (req.body.avatar) {
      resumeData.avatar = req.body.avatar;
    }

    // 验证必需字段
    if (!resumeData.name || !resumeData.position) {
      return res.status(400).json({
        error: '缺少必需字段：name 和 position',
      });
    }

    // 生成 PDF
    const pdfBuffer = await generator.generatePDFToBuffer(resumeData);

    // 返回 PDF
    const safeName = encodeURIComponent(resumeData.name);
    res.setHeader('Content-Type', 'application/pdf');
    // 使用 RFC 5987 标准编码文件名，解决中文乱码及非法字符问题
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"; filename*=UTF-8''${safeName}.pdf`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('生成 PDF 时出错:', error);
    res.status(500).json({
      error: '生成 PDF 失败',
      message: error.message,
    });
  }
});

/**
 * 健康检查接口
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * 启动服务器
 */
// ⚠️ 微信云托管强制要求监听 80 端口
const PORT = process.env.PORT || 80;

async function startServer() {
  // 🚀 部署自检 1：测试 Gemini 连通性
  console.log('🔍 正在执行部署自检: Gemini 连通性...');
  const geminiCheck = await gemini.checkConnectivity();
  
  if (geminiCheck.success) {
    console.log(`✅ ${geminiCheck.message}`);
  } else {
    console.error(`❌ ${geminiCheck.message}`);
    console.error('📋 排查信息:', JSON.stringify(geminiCheck.details, null, 2));
  }

  // 🚀 部署自检 2：测试 CLOUD_ENV 数据库连通性
  if (tcbApp) {
    console.log(`🔍 正在执行部署自检: 数据库连通性 (${FINAL_ENV_ID})...`);
    try {
      const db = tcbApp.database();
      await db.collection('users').limit(1).get();
      console.log('✅ 数据库连通性测试通过');
    } catch (error: any) {
      console.error('❌ 数据库连通性测试失败');
      console.error('   错误信息:', error.message || error);
    }
  } else {
    console.log('ℹ️ 未检测到 CLOUD_ENV 或 TCB 配置，跳过数据库连通性自检');
  }

  app.listen(PORT, () => {
    console.log(`简历生成服务已启动，端口: ${PORT}`);
    console.log(`API 端点: http://localhost:${PORT}/api/generate`);
    console.log(`健康检查: http://localhost:${PORT}/health`);
  });
}

startServer();

// 优雅关闭
process.on('SIGTERM', async () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  await generator.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('收到 SIGINT 信号，正在关闭服务器...');
  await generator.close();
  process.exit(0);
});

export default app;

