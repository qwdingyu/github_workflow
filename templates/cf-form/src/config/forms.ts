import { z } from "zod";

/** 表单字段类型 */
export type FieldType = "text" | "email" | "textarea" | "select" | "radio" | "checkbox" | "number" | "date" | "hidden" | "divider" | "heading";

/** 表单字段定义 */
export type FormField = {
  type: FieldType;
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  validation?: { min?: number; max?: number; pattern?: string };
};

/** 表单设置 */
export type FormSettings = {
  submitText?: string;
  successMessage?: string;
  allowMultipleSubmissions?: boolean;
  requireEmail?: boolean;
  turnstile?: boolean;
};

/** 提交数据验证 schema */
export const submissionSchema = z.object({
  contact: z.string().trim().min(1).max(120),
  source: z.string().trim().max(120).optional().default(""),
  turnstileToken: z.string().trim().optional(),
  fields: z.record(z.string(), z.unknown())
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

/**
 * 验证业务字段 — 根据表单定义验证提交数据
 */
export function validateBusinessFields(fields: FormField[], submittedFields: Record<string, unknown>) {
  const errors: string[] = [];
  const cleaned: Record<string, string> = {};

  for (const field of fields) {
    // 跳过装饰性字段
    if (field.type === "divider" || field.type === "heading" || field.type === "hidden") continue;

    const raw = submittedFields[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (field.required && !value) {
      errors.push(`${field.label} 必填`);
      continue;
    }

    if (!value) {
      cleaned[field.key] = "";
      continue;
    }

    if (field.validation?.max && value.length > field.validation.max) {
      errors.push(`${field.label} 不能超过 ${field.validation.max} 个字符`);
      continue;
    }

    if (field.validation?.min && value.length < field.validation.min) {
      errors.push(`${field.label} 不能少于 ${field.validation.min} 个字符`);
      continue;
    }

    if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(value)) {
      errors.push(`${field.label} 格式不正确`);
      continue;
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${field.label} 格式不正确`);
      continue;
    }

    if ((field.type === "select" || field.type === "radio") && field.options && !field.options.some(o => o.value === value)) {
      errors.push(`${field.label} 不在允许选项内`);
      continue;
    }

    cleaned[field.key] = value;
  }

  return { ok: errors.length === 0, errors, cleaned };
}
