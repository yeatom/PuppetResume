import express, { Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import cloud from 'wx-server-sdk';
import { ResumeGenerator } from './resumeGenerator';
import { ResumeData, JobData, UserResumeProfile } from './types';

const app = express();
const generator = new ResumeGenerator();

// 加载环境配置
let envConfig = {
  cloudEnv: process.env.CLOUD_ENV || cloud.DYNAMIC_TYPE_ANY,
};

try {
  // 尝试加载本地 env.js (开发环境使用)
  const localEnv = require('../env');
  if (localEnv.cloudEnv) {
    envConfig.cloudEnv = localEnv.cloudEnv;
  }
} catch (e) {
  // 生产环境通常通过云托管环境变量配置，或者直接使用 DYNAMIC_TYPE_ANY
  console.log('未检测到本地 env.js，将使用环境变量或默认配置');
}

// 初始化微信云开发
console.log('🚀 初始化云环境 ID:', envConfig.cloudEnv);
cloud.init({
  env: envConfig.cloudEnv,
});

const db = cloud.database();

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
    let resumeData: ResumeData;
    let avatar: string | undefined;

    // 检查是否有文件上传
    if (req.file) {
      // 如果有文件上传，转换为 Base64
      avatar = bufferToDataURL(req.file.buffer, req.file.mimetype);
    }

    // 解析简历数据
    if (req.body.resumeData) {
      // 如果是字符串，解析为 JSON
      if (typeof req.body.resumeData === 'string') {
        resumeData = JSON.parse(req.body.resumeData);
      } else {
        resumeData = req.body.resumeData;
      }
    } else {
      // 如果没有 resumeData 字段，尝试直接使用请求体
      resumeData = req.body;
    }

    // 如果通过文件上传提供了头像，优先使用文件上传的头像
    if (avatar) {
      resumeData.avatar = avatar;
    } else if (req.body.avatar) {
      // 否则使用请求体中的头像（URL 或 Base64）
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
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="resume-${resumeData.name}.pdf"`);
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
 * 从云数据库获取数据并生成简历
 * POST /api/generate-from-db
 * 
 * 参数：
 * - jobId: 岗位 ID
 * - userId: 用户 ID
 */
app.post('/api/generate-from-db', async (req: Request, res: Response) => {
  const { jobId, userId } = req.body;

  if (!jobId || !userId) {
    return res.status(400).json({
      error: '缺少必需参数：jobId 和 userId',
    });
  }

  try {
    // 1. 获取岗位数据
    console.log(`正在从集合 'remote_jobs' 获取数据, jobId: ${jobId}`);
    const jobRes = await db.collection('remote_jobs').doc(jobId).get();
    const jobData = jobRes.data as JobData;

    if (!jobData) {
      console.error(`未找到 jobId 为 ${jobId} 的岗位`);
      return res.status(404).json({ error: '找不到对应的岗位数据' });
    }

    // 2. 获取用户数据
    console.log(`正在从集合 'users' 获取数据, userId (openid): ${userId}`);
    const userRes = await db.collection('users').where({
      _openid: userId
    }).get();
    
    if (!userRes.data || userRes.data.length === 0) {
      console.error(`未找到 _openid 为 ${userId} 的用户`);
      return res.status(404).json({ error: '找不到对应的用户记录' });
    }
    
    // 从 users 集合的文档中提取 resume_profile 字段
    const userDoc = userRes.data[0];
    const userData = userDoc.resume_profile as UserResumeProfile;

    if (!userData) {
      console.error(`用户记录中缺少 resume_profile 字段`);
      return res.status(404).json({ error: '用户未填写简历资料' });
    }

    // 成功获取数据后，返回部分关键信息给前端验证
    res.json({
      status: 'success',
      message: '数据库查询成功',
      data: {
        job: {
          title: jobData.title_chinese || jobData.title,
          company: jobData.team,
          salary: jobData.salary
        },
        user: {
          name: userData.name,
          identity: userData.identity,
          phone: userData.phone
        }
      }
    });
  } catch (error: any) {
    console.error('查询数据库时出错:', error);
    res.status(500).json({
      error: '查询数据库失败',
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

app.listen(PORT, () => {
  console.log(`简历生成服务已启动，端口: ${PORT}`);
  console.log(`API 端点: http://localhost:${PORT}/api/generate`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
});

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

