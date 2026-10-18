/**
 * End-to-end check of ML entity detection with the real NER model.
 * Downloads the model from Hugging Face on first run (~180 MB).
 */
import { LLMDetector } from '../src/lib/detectors/LLMDetector';

// Text, and the entities a redaction user would want caught
const CASES: Array<[string, string[]]> = [
  ['甲方：北京字节跳动科技有限公司，法定代表人：张一鸣。', ['北京字节跳动科技有限公司', '张一鸣']],
  ['乙方：上海浦东新区张江路88号的李晓明先生同意以下条款。', ['上海浦东新区张江路88号', '李晓明']],
  ['本合同由王芳与深圳市腾讯计算机系统有限公司于2023年签订。', ['王芳', '深圳市腾讯计算机系统有限公司']],
  ['请联系人力资源部的陈静，她的办公地址是广州市天河区珠江新城华夏路10号。', ['陈静', '广州市天河区珠江新城华夏路10号']],
  ['患者刘建国，男，56岁，住址：浙江省杭州市西湖区文三路478号。', ['刘建国', '浙江省杭州市西湖区文三路478号']],
  ['我叫赵磊，毕业于清华大学，目前在阿里巴巴集团担任高级工程师。', ['赵磊', '清华大学', '阿里巴巴集团']],
  ['原告周杰与被告华为技术有限公司劳动争议一案，由深圳市南山区人民法院审理。', ['周杰', '华为技术有限公司', '深圳市南山区人民法院']],
  ['孙丽丽和她的丈夫吴强住在成都市武侯区。', ['孙丽丽', '吴强', '成都市武侯区']],
  ['招商银行股份有限公司南京分行的客户经理黄伟负责此账户。', ['招商银行股份有限公司南京分行', '黄伟']],
  ['欧阳娜娜在中国人民大学读书。', ['欧阳娜娜', '中国人民大学']],
  ['收件人：马云 地址：杭州市余杭区文一西路969号', ['马云', '杭州市余杭区文一西路969号']],
  ['会议由中国石油天然气集团有限公司副总经理郑志强主持，地点在北京市东城区东直门北大街9号。', ['中国石油天然气集团有限公司', '郑志强', '北京市东城区东直门北大街9号']],
  ['林小红是武汉大学附属中南医院的护士。', ['林小红', '武汉大学附属中南医院']],
  ['证人何嘉欣陈述，她当晚在香港铜锣湾见到了被告人。', ['何嘉欣', '香港铜锣湾']],
  ['该项目由小米科技有限责任公司与美团联合开发，负责人为雷军和王兴。', ['小米科技有限责任公司', '美团', '雷军', '王兴']],
  ['借款人：钱学森，身份证住址：江苏省南京市鼓楼区中山北路200号。', ['钱学森', '江苏省南京市鼓楼区中山北路200号']],
  ['致：重庆长安汽车股份有限公司 采购部 冯敏女士', ['重庆长安汽车股份有限公司', '冯敏']],
  ['简历 姓名：杨帆 工作经历：2018-2021 百度在线网络技术（北京）有限公司 产品经理', ['杨帆', '百度在线网络技术（北京）有限公司']],
  ['被保险人许文博于2022年在西安市雁塔区发生交通事故。', ['许文博', '西安市雁塔区']],
  ['Dear 张伟, 请将文件寄到 Microsoft 中国 位于北京海淀区丹棱街5号的办公室。', ['张伟', 'Microsoft', '北京海淀区丹棱街5号']],
  ['Education: Bachelor of Telecommunication Engineering, University of Sydney, 2015. Referee: James Wilson, Telstra.', ['University of Sydney', 'James Wilson', 'Telstra']],
  ['Lives in Sydney and works as a Project Manager in Information Technology for Commonwealth Bank.', ['Sydney', 'Commonwealth Bank']],
  ['Master of Business Administration (MBA), Harvard Business School. Skills: Machine Learning, Data Science.', ['Harvard Business School']],
  ['This Agreement is entered into between Acme Holdings LLC and John Smith, residing at 742 Evergreen Terrace, Springfield.', ['Acme Holdings LLC', 'John Smith', 'Springfield']],
  ['Please contact Dr. Emily Chen at Massachusetts General Hospital in Boston.', ['Emily Chen', 'Massachusetts General Hospital', 'Boston']],
  ['The plaintiff, Maria Garcia, filed suit against Wells Fargo Bank in the Northern District of California.', ['Maria Garcia', 'Wells Fargo Bank', 'California']],
  ['Candidate: Rajesh Kumar. Experience: Software Engineer at Google, Mountain View (2019-2023).', ['Rajesh Kumar', 'Google', 'Mountain View']],
  ['Signed by Olivia Brown on behalf of Brightside Consulting Ltd., London.', ['Olivia Brown', 'Brightside Consulting Ltd', 'London']],
  ['Wang Xiaoming and Li Na from Tsinghua University attended the meeting in Singapore.', ['Wang Xiaoming', 'Li Na', 'Tsinghua University', 'Singapore']],
  ['Invoice to: Kevin Nguyen, Nguyen & Partners, 55 Water Street, New York, NY 10041', ['Kevin Nguyen', 'New York']],
  ['Employee Aisha Rahman (HR) reported the incident to Priya Patel at Infosys.', ['Aisha Rahman', 'Priya Patel', 'Infosys']],
];
// Text the models used to mislabel as organizations
const NOT_ENTITIES = ['Telecommunication Engineering', 'Information Technology', 'Business Administration', 'Learning', 'Science'];

const detector = new LLMDetector();
let start = performance.now();
await detector.initialize();
console.log(`Model loaded in ${Math.round(performance.now() - start)} ms`);

let found = 0;
let total = 0;
const spurious: string[] = [];
for (const [text, expected] of CASES) {
  const entities = (await detector.detectEntitiesInChunks(text)).map(e => e.text);
  const missed = expected.filter(g => !entities.some(e => e.includes(g)));
  found += expected.length - missed.length;
  total += expected.length;
  spurious.push(...entities.filter(e => NOT_ENTITIES.some(n => e.includes(n))));
  if (missed.length) console.log(`  missed ${JSON.stringify(missed)} in "${text}" (found ${JSON.stringify(entities)})`);
}
console.log(`Recall: ${found}/${total} (${Math.round((found / total) * 100)}%)`);

// A long Chinese page: entities past the first 512 tokens used to be truncated away
const filler = '本协议的条款适用于双方当事人之间的所有交易，并在法律允许的最大范围内有效。';
const longText = filler.repeat(40) + '联系人：郑晓燕。' + filler.repeat(40) + '签约方：苏州工业园区星海街9号的何俊辉。';
start = performance.now();
const longEntities = (await detector.detectEntitiesInChunks(longText)).map(e => e.text);
const longMs = Math.round(performance.now() - start);
const longMissed = ['郑晓燕', '何俊辉', '苏州工业园区星海街9号'].filter(g => !longEntities.some(e => e.includes(g)));
console.log(`Long Chinese text (${longText.length} chars): ${longMs} ms, missed ${JSON.stringify(longMissed)}`);

const englishText = CASES.slice(20).map(([t]) => t).join(' ').repeat(6);
start = performance.now();
await detector.detectEntitiesInChunks(englishText);
console.log(`English text (${englishText.length} chars): ${Math.round(performance.now() - start)} ms`);

const failures = [
  found / total < 0.9 && `recall below 90%`,
  spurious.length > 0 && `mislabeled ${JSON.stringify(spurious)}`,
  longMissed.length > 0 && `long text missed ${JSON.stringify(longMissed)}`,
].filter(Boolean);
if (failures.length) {
  console.log(`✗ ${failures.join('; ')}`);
  process.exit(1);
}
console.log('✓ ML detection checks passed');
