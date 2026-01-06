import express, { Request, Response } from 'express';
import multer, { FileFilterCallback, Multer } from 'multer';
import { ResumeGenerator } from './resumeGenerator';
import { ResumeData } from './types';

const app = express();
const generator = new ResumeGenerator();

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
 * 健康检查接口
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * 启动服务器
 */
const PORT = process.env.PORT || 3000;

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

