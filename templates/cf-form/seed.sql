INSERT OR IGNORE INTO forms (id, slug, title, description, form_schema, settings, status, sort_order, created_at, updated_at)
VALUES (
  'form_contact',
  'contact',
  '联系我们',
  '请填写以下信息，我们会尽快回复。',
  '[{"type":"text","key":"name","label":"姓名","placeholder":"请输入您的姓名","required":true,"validation":{"min":2,"max":50}},{"type":"email","key":"email","label":"邮箱","placeholder":"your@email.com","required":true},{"type":"select","key":"subject","label":"主题","required":true,"options":[{"label":"产品咨询","value":"product"},{"label":"技术支持","value":"support"},{"label":"其他","value":"other"}]},{"type":"textarea","key":"message","label":"留言","placeholder":"请输入您的留言...","required":true,"validation":{"min":10,"max":2000}}]',
  '{"submitText":"提交","successMessage":"提交成功，我们会尽快回复！","allowMultipleSubmissions":true,"turnstile":true}',
  'active',
  100,
  datetime('now'),
  datetime('now')
);
