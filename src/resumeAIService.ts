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

    // 辅助函数：校验字段是否合法（非空且非 AI 占位符）
    const isIllegal = (val: any) => {
      if (val === undefined || val === null) return true;
      const s = String(val).trim().toLowerCase();
      // 过滤常见的 AI 逃避性占位符
      return s === "" || s === "undefined" || s === "null" || s === "nan" || s === "暂无" || s === "none";
    };

    // 直接取值，不再做复杂判断，因为你确认它不为空
    const targetTitle = isEnglish ? (job.title_english || job.title_chinese) : job.title_chinese;

    // 1. 计算最早可工作时间
    const birthYear = parseInt(profile.birthday?.split('-')[0] || "2000");
    const earliestWorkYear = birthYear + 19;
    const earliestWorkDate = `${earliestWorkYear}-07`;

    // 2. 计算实际工作年限
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    let totalMonths = 0;
    
    profile.workExperiences.forEach(exp => {
      const start = exp.startDate.split('-');
      const startYear = parseInt(start[0]);
      const startMonth = parseInt(start[1]);
      let endYear, endMonth;
      
      if (exp.endDate === '至今') {
        endYear = currentYear;
        endMonth = currentMonth;
      } else {
        const end = exp.endDate.split('-');
        endYear = parseInt(end[0]);
        endMonth = parseInt(end[1]);
      }
      
      const months = (endYear - startYear) * 12 + (endMonth - startMonth);
      totalMonths += months;
    });
    
    const actualYears = Math.floor(totalMonths / 12);
    const actualMonths = totalMonths % 12;
    const actualExperienceText = actualMonths > 0 ? `${actualYears}年${actualMonths}个月` : `${actualYears}年`;

    // 3. 解析岗位要求的年限
    const parseExperienceRequirement = (req: string): { min: number; max: number } => {
      const match = req.match(/(\d+)-(\d+)年/);
      if (match) {
        return { min: parseInt(match[1]), max: parseInt(match[2]) };
      }
      const singleMatch = req.match(/(\d+)年以上/);
      if (singleMatch) {
        return { min: parseInt(singleMatch[1]), max: 999 };
      }
      return { min: 0, max: 999 };
    };
    
    const requiredExp = parseExperienceRequirement(job.experience);
    const needsSupplement = actualYears < requiredExp.min;
    const supplementYears = needsSupplement ? requiredExp.min - actualYears : 0;
    
    // 计算补充工作经历的时间段（考虑现有工作经历之间的间隔）
    let supplementSegments: Array<{ startDate: string; endDate: string; years: number }> = [];
    if (needsSupplement && profile.workExperiences.length > 0) {
      // 将现有工作经历按开始时间排序（从早到晚）
      const sortedExistingExps = [...profile.workExperiences].sort((a, b) => {
        return a.startDate.localeCompare(b.startDate);
      });
      
      // 找到最早的工作经历开始时间
      const earliestExp = sortedExistingExps[0].startDate;
      
      // 计算可以插入补充经历的位置（两段工作之间间隔 >= 4个月）
      const insertPositions: Array<{ afterEnd: string; beforeStart: string; gapMonths: number }> = [];
      
      // 检查每两段工作经历之间的间隔
      for (let i = 0; i < sortedExistingExps.length - 1; i++) {
        const currentExp = sortedExistingExps[i];
        const nextExp = sortedExistingExps[i + 1];
        
        const currentEnd = currentExp.endDate === '至今' 
          ? `${currentYear}-${String(currentMonth).padStart(2, '0')}` 
          : currentExp.endDate;
        const nextStart = nextExp.startDate;
        
        // 计算间隔月数
        const endDate = new Date(currentEnd + '-01');
        const startDate = new Date(nextStart + '-01');
        const gapMonths = (startDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        
        // 如果间隔 >= 4个月，记录这个位置
        if (gapMonths >= 4) {
          insertPositions.push({
            afterEnd: currentEnd,
            beforeStart: nextStart,
            gapMonths: Math.floor(gapMonths)
          });
        }
      }
      
      // 从最早工作经历往前推，补充工作经历
      let remainingYears = supplementYears;
      let currentEnd = earliestExp;
      
      // 先尝试在现有工作经历之间的间隔中插入补充经历
      for (const pos of insertPositions) {
        if (remainingYears <= 0) break;
        
        // 计算可以在这个间隔中插入多少年
        const availableYears = Math.min(remainingYears, pos.gapMonths / 12, 3); // 最多3年，且不超过间隔
        
        if (availableYears >= 0.5) { // 至少半年才值得插入
          const endDate = new Date(pos.beforeStart + '-01');
          endDate.setMonth(endDate.getMonth() - 1); // 往前推1个月，避免重叠
          const startDate = new Date(endDate);
          startDate.setFullYear(startDate.getFullYear() - Math.floor(availableYears));
          
          // 确保不早于前一段工作的结束时间
          const prevEndDate = new Date(pos.afterEnd + '-01');
          if (startDate < prevEndDate) {
            startDate.setTime(prevEndDate.getTime());
            startDate.setMonth(startDate.getMonth() + 1); // 往后推1个月，避免重叠
          }
          
          const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
          const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
          
          // 计算实际的工作年限（考虑月份）
          const actualMonths = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
          const actualYearsForSegment = Math.floor(actualMonths / 12);
          
          if (actualYearsForSegment > 0) {
            supplementSegments.push({
              startDate: startStr,
              endDate: endStr,
              years: actualYearsForSegment
            });
            remainingYears -= actualYearsForSegment;
          }
        }
      }
      
      // 如果还需要补充，从最早工作经历往前推
      while (remainingYears > 0) {
        const segmentYears = Math.min(remainingYears, 3); // 每段最多3年
        const endDate = new Date(currentEnd + '-01');
        endDate.setMonth(endDate.getMonth() - 1); // 往前推1个月，避免重叠
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - segmentYears);
        
        // 检查是否早于最早可工作日期
        const earliestWorkDateObj = new Date(earliestWorkDate + '-01');
        if (startDate < earliestWorkDateObj) {
          startDate.setTime(earliestWorkDateObj.getTime());
          // 如果被限制了，重新计算实际的工作年限
          const actualSegmentMonths = Math.max(0, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
          const actualSegmentYears = Math.floor(actualSegmentMonths / 12);
          remainingYears -= actualSegmentYears;
          if (actualSegmentYears <= 0) {
            break; // 如果无法再补充，退出循环
          }
        } else {
          remainingYears -= segmentYears;
        }
        
        const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
        const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
        
        // 计算实际的工作年限（考虑月份）
        const actualMonths = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        const actualYearsForSegment = Math.floor(actualMonths / 12);
        
        supplementSegments.push({
          startDate: startStr,
          endDate: endStr,
          years: actualYearsForSegment
        });
        
        currentEnd = startStr;
      }
    }
    
    // 构建所有工作经历的时间线（用于排序和插入位置判断）
    const allWorkExperiences: Array<{ startDate: string; endDate: string; type: 'existing' | 'supplement'; index?: number }> = [];
    
    // 添加现有工作经历
    profile.workExperiences.forEach((exp, idx) => {
      allWorkExperiences.push({
        startDate: exp.startDate,
        endDate: exp.endDate === '至今' ? `${currentYear}-${String(currentMonth).padStart(2, '0')}` : exp.endDate,
        type: 'existing',
        index: idx
      });
    });
    
    // 添加补充工作经历
    supplementSegments.forEach(seg => {
      allWorkExperiences.push({
        startDate: seg.startDate,
        endDate: seg.endDate,
        type: 'supplement'
      });
    });
    
    // 按开始时间倒序排序（最新的在最前面）
    allWorkExperiences.sort((a, b) => {
      const dateA = new Date(a.startDate + '-01').getTime();
      const dateB = new Date(b.startDate + '-01').getTime();
      return dateB - dateA; // 倒序：最新的在前
    });

    // 4. 构造 Prompt
    const prompt = `
你是一位顶级的简历包装专家。你的核心原则是：【一切以目标岗位为准】。

### 🚨 核心指令 (必须严格执行)
1. **身份锁死**：生成的简历【职位名称】(\`position\`) 必须且只能是："${targetTitle}"。
2. **彻底抹除无关背景**：如果用户原始背景与"${targetTitle}"不相符，必须在职责描述中【彻底移除】原有的不相关技术栈或业务痕迹。
3. **经历强力重塑**：
   - 保持公司名称和时间段不变，根据"业务方向"将职位名和职责重写为与"${targetTitle}"高度匹配的角色。
   - **职级命名原则 (SENIORITY GUIDELINES)**：严禁盲目使用"资深"字眼。请优先考虑使用"高级"作为职级提升的描述，并根据工作年限合理分配：
     - 累计年限 < 3年：严禁出现"高级"、"资深"。
     - 累计年限 3-7年：推荐使用"高级(Senior)"，禁止使用"资深"。
     - 累计年限 7年以上：可根据实际业务量级使用"高级"或慎重使用"资深"。

### 1. 目标岗位信息
- 岗位名称: ${targetTitle}
- 岗位描述: ${job.description_chinese}
- 经验要求: ${job.experience} (最低要求: ${requiredExp.min}年)

### 2. 用户背景
- 姓名: ${profile.name}
- AI 指令: ${profile.aiMessage}
- 最早工作日限制: ${earliestWorkDate} (不能早于此日期)

### 3. 工作经历分析
- **实际工作年限**: ${actualExperienceText} (${totalMonths}个月)
- **岗位要求年限**: ${job.experience} (最低 ${requiredExp.min}年)
- **是否需要补充**: ${needsSupplement ? '是' : '否'} ${needsSupplement ? `(需要补充约 ${requiredExp.min - actualYears} 年)` : ''}

### 4. 工作经历补充规则 (${needsSupplement ? '必须执行' : '无需执行'})
${needsSupplement ? `
**实际工作年限不足，必须补充工作经历：**

**需要补充的总年限**: ${supplementYears} 年

**补充工作经历的时间段（必须严格按照以下时间段生成）：**
${supplementSegments.map((seg, idx) => `
补充经历 ${idx + 1}:
- 时间段: ${seg.startDate} 至 ${seg.endDate} (${seg.years}年)
- 公司名称: 根据目标岗位"${targetTitle}"的特点，生成一个符合该岗位风格的工作室名称。例如：
  * 科技/开发岗位：生成有科技感的工作室名称（如"智创科技工作室"、"云码技术工作室"等）
  * 运营/电商岗位：生成运营风格的工作室名称（如"跨境优选工作室"、"数字营销工作室"等）
  * 产品岗位：生成产品相关的工作室名称（如"创新产品工作室"、"用户体验工作室"等）
  * Web3/Crypto岗位：生成Web3风格的工作室名称（如"链上创新工作室"、"数字资产工作室"等）
  要求：名称要自然、真实，符合该行业的工作室命名习惯，不要过于夸张或AI感。
- 职位名称: 根据目标岗位"${targetTitle}"和岗位描述灵活生成：
  * 如果目标岗位描述清晰、职位名称明确（如"产品经理"、"Java开发工程师"），可以直接使用相同的职位名称，也可以使用相关职位（如"产品专员"、"产品助理"、"Java开发"等）
  * 如果目标岗位描述不清晰或职位名称不够具体，可以根据岗位描述生成最贴切该岗位描述的职位名称
  * 要符合该时间段的职级水平（早期经历用初级职位，后期经历可以用中级职位）
  * 总体原则：职位名称要自然、真实，符合该行业和该时间段的职级水平
- 工作内容: 围绕"${targetTitle}"的核心职责展开，但要符合该职位的初级/中级水平（${seg.years}年经验对应的水平）
`).join('\n')}

**⚠️ 所有工作经历的时间线（按时间倒序，最新的在最上面）：**
${allWorkExperiences.map((exp, idx) => {
  if (exp.type === 'existing') {
    const origExp = profile.workExperiences[exp.index!];
    return `${idx + 1}. [现有经历] ${origExp.company} - ${origExp.startDate} 至 ${origExp.endDate}`;
  } else {
    return `${idx + 1}. [补充经历] [根据目标岗位"${targetTitle}"生成符合该岗位风格的工作室名称] - ${exp.startDate} 至 ${exp.endDate}`;
  }
}).join('\n')}

**补充规则说明：**
1. **必须严格按照上述时间段生成补充经历**，不能修改时间段
2. **公司名称**：根据目标岗位"${targetTitle}"的特点，生成一个符合该岗位风格的工作室名称。要求自然、真实，符合该行业的工作室命名习惯，不要过于夸张或AI感。
3. **时间连续性**：补充的经历应该与现有经历在时间上连续，不能有重叠
4. **职位名称**：根据目标岗位"${targetTitle}"和岗位描述灵活生成：
   * 如果目标岗位描述清晰、职位名称明确，可以直接使用相同的职位名称，也可以使用相关职位
   * 如果目标岗位描述不清晰或职位名称不够具体，可以根据岗位描述生成最贴切该岗位描述的职位名称
   * 要符合该时间段的职级水平（早期经历用初级职位，后期经历可以用中级职位）
   * 总体原则：职位名称要自然、真实，符合该行业和该时间段的职级水平
5. **⚠️ 关键：所有工作经历必须严格按照上述时间线顺序排列**（最新的在最上面，最老的放在最下面）
6. **补充经历应该插入到正确的时间位置**，而不是简单地放在最后。参考上面的时间线，补充经历可能出现在现有经历之间。
` : '实际工作年限已满足要求，无需补充工作经历。'}

### 5. 现有工作经历 (需根据业务方向进行完全重塑)
${profile.workExperiences.map((exp, i) => `
经历 ${i + 1}:
- 公司: ${exp.company}
- 原始职位: ${exp.jobTitle}
- 业务方向: ${exp.businessDirection}
- 时间: ${exp.startDate} 至 ${exp.endDate}
`).join('\n')}

### 6. 任务
1. **工作年限**：如果${needsSupplement ? '需要补充' : '不需要补充'}，最终输出的 \`yearsOfExperience\` 应该${needsSupplement ? `达到或接近 ${requiredExp.min} 年` : '等于实际工作年限'}。
2. **工作经历排序**：${needsSupplement ? `严格按照上面时间线的顺序输出所有工作经历（最新的在最上面，最老的放在最下面）。补充的经历必须插入到正确的时间位置，不能简单地放在最后。` : '输出重塑后的现有工作经历，按时间倒序排列（最新的在最上面）。'}
3. 个人简介: 表现出是"${targetTitle}"领域的专业人士。
4. 专业技能: 最多 4 个大类，每类 3-4 点。
5. 工作职责: 每段经历 4-6 条，使用行业术语。
6. 排版: 3-4 处 <b> 加粗，3-4 处 <u> 下划线。

### 7. 输出格式 (纯 JSON)
{
  "position": "${targetTitle}",
  "yearsOfExperience": ${needsSupplement ? requiredExp.min : actualYears},
  "personalIntroduction": "...",
  "professionalSkills": [{ "title": "类别", "items": [...] }],
  "workExperience": [
    ${needsSupplement ? `// ⚠️ 重要：严格按照上面时间线的顺序输出（最新的在最上面，最老的放在最下面）
    // 参考时间线顺序：
${allWorkExperiences.map((exp, idx) => {
  if (exp.type === 'existing') {
    const origExp = profile.workExperiences[exp.index!];
    return `    // ${idx + 1}. [现有] ${origExp.company} - ${origExp.startDate} 至 ${origExp.endDate}`;
  } else {
    return `    // ${idx + 1}. [补充] [根据目标岗位"${targetTitle}"生成符合该岗位风格的工作室名称] - ${exp.startDate} 至 ${exp.endDate}`;
  }
}).join('\n')}
    // 按照上述顺序输出，示例：
    { "company": "...", "position": "适配后的新职位", "startDate": "...", "endDate": "...", "responsibilities": [...] },
    // 如果补充经历在中间，就插入到对应位置
    { "company": "[根据目标岗位'${targetTitle}'生成符合该岗位风格的工作室名称，如科技岗用'智创科技工作室'、运营岗用'跨境优选工作室'等]", "position": "[根据目标岗位'${targetTitle}'和岗位描述灵活生成：如果岗位描述清晰可直接用相同职位名称，如果描述不清晰则生成最贴切的职位名称，要符合该时间段的职级水平]", "startDate": "...", "endDate": "...", "responsibilities": [...] },
    { "company": "...", "position": "适配后的新职位", "startDate": "...", "endDate": "...", "responsibilities": [...] }` : `// 重塑后的现有工作经历（按时间倒序，最新的在最上面）\n    { "company": "...", "position": "适配后的新职位", "startDate": "...", "endDate": "...", "responsibilities": [...] }`}
  ]
}

**⚠️ 关键要求：**
${needsSupplement ? `- workExperience 数组必须严格按照上面时间线的顺序输出（最新的在最上面，最老的放在最下面）
- 补充的工作经历必须插入到正确的时间位置，不能简单地放在最后
- 补充的工作经历时间段必须严格按照上面指定的时间段，不能修改
- 补充的工作经历公司名称：根据目标岗位"${targetTitle}"的特点，生成一个符合该岗位风格的工作室名称。要求自然、真实，符合该行业的工作室命名习惯，不要过于夸张或AI感。例如：
  * 科技/开发岗位：生成有科技感的工作室名称（如"智创科技工作室"、"云码技术工作室"等）
  * 运营/电商岗位：生成运营风格的工作室名称（如"跨境优选工作室"、"数字营销工作室"等）
  * 产品岗位：生成产品相关的工作室名称（如"创新产品工作室"、"用户体验工作室"等）
  * Web3/Crypto岗位：生成Web3风格的工作室名称（如"链上创新工作室"、"数字资产工作室"等）` : '- workExperience 数组包含重塑后的现有工作经历，按时间倒序排列（最新的在最上面）'}

输出语言: ${isEnglish ? 'English' : 'Chinese'}
`;

    try {
      const aiResponse = await this.gemini.generateContent(prompt, (text) => {
        try {
          const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
          const data = JSON.parse(jsonStr);
          
          // 严格验证字段，如果缺失或包含非法内容，返回 false 触发重试/切模型
          const requiredFields = ['position', 'yearsOfExperience', 'personalIntroduction', 'professionalSkills', 'workExperience'];
          for (const field of requiredFields) {
            if (isIllegal(data[field])) {
              throw new Error(`关键字段 "${field}" 内容非法或缺失`);
            }
          }
          return true;
        } catch (e: any) {
          throw new Error(`JSON 逻辑校验未通过: ${e.message}`);
        }
      });

      // 如果能执行到这里，说明已经通过了上面的 validator 校验
      const jsonStr = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const enhancedData = JSON.parse(jsonStr);

      // 合并数据
      return {
        ...baseData,
        position: targetTitle, // 依然强制使用我们预期的标题
        yearsOfExperience: enhancedData.yearsOfExperience,
        personalIntroduction: enhancedData.personalIntroduction,
        professionalSkills: enhancedData.professionalSkills,
        workExperience: enhancedData.workExperience,
      };
    } catch (error: any) {
      // 这里的错误会向上抛给 runBackgroundTask，从而触发数据库状态更新为 failed
      console.error("AI 增强流程异常:", error.message);
      throw error;
    }
  }
}
