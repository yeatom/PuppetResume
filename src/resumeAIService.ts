import { GeminiService } from "./geminiService";
import { GenerateFromFrontendRequest, ResumeData, mapFrontendRequestToResumeData } from "./types";

export class ResumeAIService {
  private gemini: GeminiService;

  constructor() {
    this.gemini = new GeminiService();
  }

  /**
   * 核心方法：利用 AI 增强简历内容
   */
  async enhance(payload: GenerateFromFrontendRequest): Promise<ResumeData> {
    const baseData = mapFrontendRequestToResumeData(payload);
    const { resume_profile: profile, job_data: job, language } = payload;
    const isEnglish = language === 'english';

    // 1. 计算最早可工作时间 (出生年 + 19 岁)
    const birthYear = parseInt(profile.birthday.split('-')[0]);
    const earliestWorkYear = birthYear + 19;
    const earliestWorkDate = `${earliestWorkYear}-07`;

    // 2. 提取岗位要求的年限 (例如 "5-10年" -> 5)
    const requiredYearsMatch = job.experience.match(/(\d+)/);
    const requiredYears = requiredYearsMatch ? parseInt(requiredYearsMatch[1]) : 0;

    // 3. 构造 Prompt
    const prompt = `
你是一位顶级的简历包装专家和资深猎头。你的核心原则是：【一切以目标岗位为准】。

### 🚨 核心指令 (TOP PRIORITY)
1. **完全适配原则**：如果用户的原始履历、经验、职位或技能与“目标岗位”不符，你必须【推翻并重新编写】。生成的简历必须看起来像是该用户在这个行业深耕多年的专家。
2. **职位强行对齐**：无论用户原始职位是什么，你生成的 \`position\` 必须直接使用或高度贴合“目标岗位”名称。
3. **经历逻辑化重塑**：
   - 保持公司名称和时间段不变。
   - 利用提供的“业务方向”作为背景，将职位名和职责描述彻底改造为与“目标岗位”强相关的角色。
   - **职位命名规范 (NATURAL HUMAN TITLES)**：严禁使用类似“数字化质量控制专家”、“全域流程监控官”这种AI味极重的、听起来很虚的头衔。请使用真实职场中人类会使用的自然职位名。
   - 例如：目标岗是“试卷质检”，用户在“教育直播公司”：
     - ✅ 推荐职位：**课程质检主管**、**教研内容管理**、**试卷审核组长**、**教务质检**。
     - ❌ 禁用职位：数字化课件质量控制专家、教学内容质量闭环工程师。

### 1. 目标岗位信息
- 岗位名称: ${job.title_chinese} / ${job.title_english}
- 岗位描述: ${job.description_chinese}
- 经验要求: ${job.experience}

### 2. 用户基础背景 (仅供参考)
- 姓名: ${profile.name}
- 身份: ${profile.identity}
- AI 指令: ${profile.aiMessage}
- 最早可开始工作时间限制: ${earliestWorkDate}

### 3. 当前工作经历 (需根据业务方向进行【完全重塑】)
${profile.workExperiences.map((exp, i) => `
经历 ${i + 1}:
- 公司: ${exp.company}
- 原始职位: ${exp.jobTitle} (忽略此职位的技术属性，根据业务方向重写)
- 业务方向: ${exp.businessDirection} (👈 核心背景依据)
- 时间: ${exp.startDate} 至 ${exp.endDate}
`).join('\n')}

### 4. 任务要求
一、内容生成：
1. 个人简介 (personalIntroduction): 必须展现出对该岗位极高的专业度和热忱。
2. 专业技能 (professionalSkills): 最多 4 个大类，每类 3-4 个要点。必须全部围绕目标岗位的核心能力要求编写。
3. 工作职责 (responsibilities): 每段经历生成 4-6 条具体的职责描述。严禁用词空洞，必须有具体的业务动作。

二、排版与标签：
1. 整个简历中，必须包含 3-4 处加粗 (使用 <b> 标签) 和 3-4 处下划线 (使用 <u> 标签)。
2. 每个标签包裹的内容不得超过 10 个汉字。

### 5. 输出格式
请直接返回 JSON 格式，不要包含任何 Markdown 代码块。格式：
{
  "position": "目标岗位名称",
  "yearsOfExperience": 数字,
  "personalIntroduction": "内容...",
  "professionalSkills": [{ "title": "类别", "items": ["要点1", "..."] }],
  "workExperience": [{
    "company": "...",
    "position": "适配后的新职位",
    "startDate": "...",
    "endDate": "...",
    "responsibilities": ["职责1...", "职责2..."]
  }]
}

输出语言: ${isEnglish ? 'English' : 'Chinese'}
`;

    try {
      const aiResponse = await this.gemini.generateContent(prompt);
      // 清理可能的 Markdown 标记
      const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const enhancedData = JSON.parse(jsonStr);

      // 合并数据
      return {
        ...baseData,
        position: enhancedData.position || baseData.position,
        yearsOfExperience: enhancedData.yearsOfExperience || baseData.yearsOfExperience,
        personalIntroduction: enhancedData.personalIntroduction,
        professionalSkills: enhancedData.professionalSkills,
        workExperience: enhancedData.workExperience,
      };
    } catch (error) {
      console.error("AI 增强失败，降级使用原始数据:", error);
      return baseData;
    }
  }
}
