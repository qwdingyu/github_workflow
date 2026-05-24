const formSlug = new URLSearchParams(location.search).get("form") || "lead";
const formEl = document.querySelector("#lead-form");
const fieldsEl = document.querySelector("#fields");
const titleEl = document.querySelector("#form-title");
const descriptionEl = document.querySelector("#form-description");
const buttonEl = document.querySelector("#submit-button");
const messageEl = document.querySelector("#message");

function fieldControl(field) {
  const id = `field-${field.name}`;
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  wrapper.htmlFor = id;
  wrapper.textContent = field.label;

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
      item.value = option;
      item.textContent = option;
      input.append(item);
    }
  } else {
    input = document.createElement("input");
    input.type = field.type === "email" ? "email" : "text";
  }

  input.id = id;
  input.name = field.name;
  input.required = Boolean(field.required);
  if (field.maxLength) input.maxLength = field.maxLength;
  wrapper.append(input);
  return wrapper;
}

async function loadForm() {
  const response = await fetch(`/api/forms/${formSlug}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "表单加载失败");

  titleEl.textContent = data.form.title;
  descriptionEl.textContent = data.form.description;
  buttonEl.textContent = data.form.submitLabel;
  fieldsEl.replaceChildren(...data.form.fields.map(fieldControl));
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.textContent = "";
  buttonEl.disabled = true;

  const formData = new FormData(formEl);
  const fields = {};
  for (const [key, value] of formData.entries()) {
    if (key !== "source") fields[key] = String(value);
  }

  const payload = {
    contact: fields.contact || fields.email || fields.name || "unknown",
    source: String(formData.get("source") || ""),
    fields
  };

  try {
    const response = await fetch(`/api/forms/${formSlug}/submissions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `web:${crypto.randomUUID()}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "提交失败");
    formEl.reset();
    messageEl.textContent = "已提交，我们会尽快处理。";
  } catch (error) {
    messageEl.textContent = error.message || "提交失败，请稍后再试。";
  } finally {
    buttonEl.disabled = false;
  }
});

loadForm().catch((error) => {
  messageEl.textContent = error.message || "表单加载失败";
});
