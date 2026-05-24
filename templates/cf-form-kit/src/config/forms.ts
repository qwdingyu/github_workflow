import { z } from "zod";

export type FieldType = "text" | "email" | "textarea" | "select";

export type FormField = {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  options?: string[];
};

export type FormDefinition = {
  slug: string;
  title: string;
  description: string;
  submitLabel: string;
  fields: FormField[];
};

export const forms: FormDefinition[] = [
  {
    slug: "lead",
    title: "资料领取登记",
    description: "用于落地页、活动页、社群拉新和轻量信息收集。",
    submitLabel: "提交登记",
    fields: [
      {
        name: "name",
        label: "称呼",
        type: "text",
        required: true,
        maxLength: 40
      },
      {
        name: "contact",
        label: "联系方式",
        type: "text",
        required: true,
        maxLength: 120
      },
      {
        name: "interest",
        label: "感兴趣的内容",
        type: "select",
        required: true,
        options: ["虚拟资料", "视频会员", "工具咨询", "合作交流"]
      },
      {
        name: "note",
        label: "补充说明",
        type: "textarea",
        required: false,
        maxLength: 500
      }
    ]
  }
];

export function getFormDefinition(slug: string) {
  return forms.find((form) => form.slug === slug);
}

export const submissionSchema = z.object({
  contact: z.string().trim().min(3).max(120),
  source: z.string().trim().max(120).optional().default(""),
  turnstileToken: z.string().trim().optional(),
  fields: z.record(z.string(), z.unknown())
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export function validateBusinessFields(form: FormDefinition, fields: Record<string, unknown>) {
  const errors: string[] = [];
  const cleaned: Record<string, string> = {};

  for (const field of form.fields) {
    const raw = fields[field.name];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (field.required && !value) {
      errors.push(`${field.label} 必填`);
      continue;
    }

    if (!value) {
      cleaned[field.name] = "";
      continue;
    }

    if (field.maxLength && value.length > field.maxLength) {
      errors.push(`${field.label} 不能超过 ${field.maxLength} 个字符`);
      continue;
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${field.label} 格式不正确`);
      continue;
    }

    if (field.type === "select" && field.options && !field.options.includes(value)) {
      errors.push(`${field.label} 不在允许选项内`);
      continue;
    }

    cleaned[field.name] = value;
  }

  return {
    ok: errors.length === 0,
    errors,
    cleaned
  };
}
