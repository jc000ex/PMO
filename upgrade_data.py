"""升级 projects.json 数据模型：拆分字段、添加新表格"""
import json, os

src = os.path.join(os.path.dirname(__file__), 'data', 'projects.json')
projects = json.load(open(src, 'r', encoding='utf-8'))

for p in projects:
    # 旧 description 移入 background
    p['background'] = p.pop('description', '')
    p['objectives'] = ''
    p['scope'] = ''
    p['acceptanceCriteria'] = ''
    # 干系人表格
    p['stakeholders'] = []
    # 风险管理表格（区分旧 risks 字段）
    old_risks = p.pop('risks', [])
    p['riskPlan'] = []
    if old_risks:
        for r in old_risks:
            p['riskPlan'].append({
                'category': '',
                'content': str(r) if isinstance(r, str) else r.get('content', ''),
                'solution': ''
            })
    # 变更记录
    p['changeLog'] = []
    # 当前摘要
    p['summary'] = ''

json.dump(projects, open(src, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'升级完成：{len(projects)} 个项目')
for p in projects:
    print(f"  {p['name'][:30]}... | 干系人:{len(p['stakeholders'])} | 风险:{len(p['riskPlan'])} | 变更:{len(p['changeLog'])}")
