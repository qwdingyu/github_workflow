/**
 * cf-form 表单渲染器
 *
 * 从 /api/forms/:slug 获取 JSON 表单定义，动态渲染表单。
 * 支持字段类型：text / email / textarea / select / radio / checkbox / number / date / hidden / divider / heading
 */

const formSlug = new URLSearchParams(location.search).get("form") || "contact";
const formEl = document.querySelector("#cf-form");
const fieldsEl = document.querySelector("#fields");
const titleEl = document.querySelector("#form-title");
const descriptionEl = document.querySelector("#form-description");
const buttonEl = document.querySelector("#submit-button");
const messageEl = document.querySelector("#message");

/** 根据字段定义创建表单控件 */
function fieldControl(field) {
  // 装饰性字段
  if (field.type === "divider") {
    const hr = document.createElement("hr");
    hr.className = "field-divider";
    return hr;
  }
  if (field.type === "heading") {
    const h = document.createElement("h3");
    h.className = "field-heading";
    h.textContent = field.label;
    return h;
  }

  const id = `field-${field.key}`;

  // hidden 字段
  if (field.type === "hidden") {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = field.key;
    input.value = field.value || "";
    return input;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "field";

  // checkbox 不需要 label 包裹
  if (field.type === "checkbox") {
    const label = document.createElement("label");
    label.className = "field-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.name = field.key;
    input.required = Boolean(field.required);
    label.append(input);
    label.append(document.createTextNode(` ${field.label}`));
    wrapper.append(label);
    return wrapper;
  }

  // label
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = field.label;
  if (field.required) {
    const req = document.createElement("span");
    req.className = "required";
    req.textContent = " *";
    label.append(req);
  }
  wrapper.append(label);

  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 4;
  } else if (field.type === "select") {
    input = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "请选择";
    input.append(empty);
    for (const option of field.options || []) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      input.append(item);
    }
  } else if (field.type === "radio") {
    const group = document.createElement("div");
    group.className = "radio-group";
    for (const option of field.options || []) {
      const radioLabel = document.createElement("label");
      radioLabel.className = "radio-option";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = field.key;
      radio.value = option.value;
      radio.required = Boolean(field.required);
      radioLabel.append(radio);
      radioLabel.append(document.createTextNode(` ${option.label}`));
      group.append(radioLabel);
    }
    wrapper.append(group);
    return wrapper;
  } else {
    input = document.createElement("input");
    input.type = field.type; // text / email / number / date
  }

  input.id = id;
  input.name = field.key;
  input.required = Boolean(field.required);
  if (field.placeholder) input.placeholder = field.placeholder;
  if (field.validation?.max) input.maxLength = field.validation.max;
  if (field.validation?.min && field.type !== "text" && field.type !== "textarea") input.min = field.validation.min;
  if (field.validation?.max && (field.type === "number" || field.type === "date")) input.max = field.validation.max;
  wrapper.append(input);
  return wrapper;
}

/** 加载表单定义并渲染 */
async function loadForm() {
  const response = await fetch(`/api/forms/${formSlug}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "表单加载失败");

  const form = data.form;
  titleEl.textContent = form.title;
  descriptionEl.textContent = form.description;

  const settings = form.settings || {};
  buttonEl.textContent = settings.submitText || "提交";

  // 渲染表单字段
  const elements = form.formSchema.map(fieldControl);
  fieldsEl.replaceChildren(...elements);

  // 添加隐藏的 source 字段
  const sourceInput = document.createElement("input");
  sourceInput.type = "hidden";
  sourceInput.name = "source";
  sourceInput.value = new URLSearchParams(location.search).get("source") || "web";
  formEl.append(sourceInput);
}

/** 表单提交 */
formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";
  messageEl.className = "message";
  buttonEl.disabled = true;

  const formData = new FormData(formEl);
  const fields = {};
  for (const [key, value] of formData.entries()) {
    if (key !== "source") fields[key] = String(value);
  }

  // checkbox 特殊处理
  formEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    fields[cb.name] = cb.checked ? "true" : "false";
  });

  const payload = {
    contact: fields.contact || fields.email || fields.name || "unknown",
    source: String(formData.get("source") || ""),
    fields,
  };

  try {
    const response = await fetch(`/api/forms/${formSlug}/submissions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `web:${crypto.randomUUID()}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "提交失败");
    formEl.reset();
    messageEl.textContent = data.settings?.successMessage || "提交成功，我们会尽快处理。";
    messageEl.className = "message success";
  } catch (error) {
    messageEl.textContent = error.message || "提交失败，请稍后再试。";
    messageEl.className = "message error";
  } finally {
    buttonEl.disabled = false;
  }
});

loadForm().catch((error) => {
  messageEl.textContent = error.message || "表单加载失败";
  messageEl.className = "message error";
});
