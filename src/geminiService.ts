import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Gemini 服务类
 */
export class GeminiService {
  private apiKey: string;
  private baseUrl: string = "https://gemini.yeatom.online";

  constructor() {
    this.apiKey = process.env.GEMINI_API || "";
    if (!this.apiKey) {
      console.warn("⚠️ 未检测到 GEMINI_API 环境变量");
    }
  }

  /**
   * 极简连通性测试：不浪费配额，提供详细错误排查
   */
  async checkConnectivity(): Promise<{ success: boolean; message: string; details?: any }> {
    if (!this.apiKey) {
      return { success: false, message: "环境变量 GEMINI_API 为空" };
    }

    try {
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel(
        { model: "gemini-2.0-flash" },
        { baseUrl: this.baseUrl }
      );

      // 使用极简请求，几乎不消耗 token
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: "p" }] }],
        generationConfig: { maxOutputTokens: 1 } 
      });
      
      await result.response;
      return { success: true, message: "Gemini 连通性测试通过" };
    } catch (error: any) {
      let errorMsg = error.message || "未知错误";
      
      // 常见错误排查指南
      if (errorMsg.includes("403")) errorMsg += " (可能是 API Key 无效或未启用 Gemini API)";
      if (errorMsg.includes("404")) errorMsg += " (可能是域名/模型路径错误)";
      if (errorMsg.includes("fetch failed")) errorMsg += " (网络不可达，请检查域名解析或代理设置)";
      
      return { 
        success: false, 
        message: "Gemini 连通性测试失败", 
        details: {
          error: errorMsg,
          baseUrl: this.baseUrl,
          apiKeyPrefix: this.apiKey.substring(0, 5) + "...",
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * 核心调用方法：带重试机制
   * 优先调用 gemini-2.0-flash，失败后调用 gemini-2.5-pro
   */
  async generateContent(prompt: string): Promise<string> {
    const models = ["gemini-2.0-flash", "gemini-2.5-pro"];
    
    for (const modelName of models) {
      try {
        console.log(`🤖 尝试使用模型: ${modelName}`);
        const genAI = new GoogleGenerativeAI(this.apiKey);
        
        // 配置自定义域名（通过设置 API 网关或代理）
        const model = genAI.getGenerativeModel(
          { model: modelName },
          { baseUrl: this.baseUrl }
        );

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log(`✅ ${modelName} 调用成功`);
        return text;
      } catch (error: any) {
        console.error(`❌ ${modelName} 调用失败:`, error.message);
        // 如果是最后一个模型也失败了，则抛出错误
        if (modelName === models[models.length - 1]) {
          throw new Error(`所有 Gemini 模型调用均失败: ${error.message}`);
        }
        console.log("🔄 正在尝试切换到备用模型...");
      }
    }
    
    return "";
  }
}

/**
 * 测试脚本
 */
async function testGemini() {
  const service = new GeminiService();
  const testPrompt = "你好，请简单介绍一下你自己。";
  
  try {
    console.log("🚀 开始测试 Gemini 调用...");
    const response = await service.generateContent(testPrompt);
    console.log("📝 Gemini 回复内容:");
    console.log(response);
  } catch (error) {
    console.error("💥 测试过程中出现严重错误:", error);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  testGemini();
}

