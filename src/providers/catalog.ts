// Generated from 9Router Provider Registry
export interface ProviderCatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  maxOutputTokens?: number;
}

export interface ProviderCatalogItem {
  id: string;
  alias: string;
  name: string;
  color: string;
  textIcon: string;
  icon: string;
  website: string;
  notice: string;
  apiKeyUrl: string;
  format: "openai" | "claude" | string;
  baseUrl: string;
  modelsFetcherUrl?: string;
  models: ProviderCatalogModel[];
}

export const PROVIDERS_CATALOG: ProviderCatalogItem[] = [
  {
    "id": "alicode-intl",
    "alias": "alicode-intl",
    "name": "Alibaba Coding",
    "color": "#FF6A00",
    "textIcon": "ALi",
    "icon": "alicode-intl",
    "website": "https://www.alibabacloud.com/product/coding",
    "notice": "",
    "apiKeyUrl": "https://www.alibabacloud.com/product/coding",
    "format": "openai",
    "baseUrl": "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen3-coder-plus",
        "name": "Qwen3 Coder Plus"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      }
    ]
  },
  {
    "id": "alicode",
    "alias": "alicode",
    "name": "Alibaba",
    "color": "#FF6A00",
    "textIcon": "ALi",
    "icon": "alicode",
    "website": "https://bailian.console.aliyun.com",
    "notice": "",
    "apiKeyUrl": "https://bailian.console.aliyun.com/?apiKey=1",
    "format": "openai",
    "baseUrl": "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3-max-2026-01-23",
        "name": "Qwen3 Max"
      },
      {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen3-coder-plus",
        "name": "Qwen3 Coder Plus"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      }
    ]
  },
  {
    "id": "anthropic",
    "alias": "anthropic",
    "name": "Anthropic",
    "color": "#D97757",
    "textIcon": "AN",
    "icon": "anthropic",
    "website": "https://console.anthropic.com",
    "notice": "",
    "apiKeyUrl": "https://console.anthropic.com/settings/keys",
    "format": "claude",
    "baseUrl": "https://api.anthropic.com/v1/messages",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "claude-sonnet-4-20250514",
        "name": "Claude Sonnet 4"
      },
      {
        "id": "claude-opus-4-20250514",
        "name": "Claude Opus 4"
      },
      {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet"
      }
    ]
  },
  {
    "id": "azure",
    "alias": "azure",
    "name": "Azure OpenAI",
    "color": "#0078D4",
    "textIcon": "AZ",
    "icon": "azure",
    "website": "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    "notice": "",
    "apiKeyUrl": "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
    "format": "openai",
    "baseUrl": "",
    "modelsFetcherUrl": "",
    "models": []
  },
  {
    "id": "blackbox",
    "alias": "blackbox",
    "name": "Blackbox AI",
    "color": "#5B5FEF",
    "textIcon": "BB",
    "icon": "blackbox",
    "website": "https://blackbox.ai",
    "notice": "",
    "apiKeyUrl": "https://www.blackbox.ai/api-management",
    "format": "openai",
    "baseUrl": "https://api.blackbox.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "claude-fable-5",
        "name": "Claude Fable 5"
      },
      {
        "id": "claude-opus-4.8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4-pro",
        "name": "GPT-5.4 Pro"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT-5.3 Codex"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3"
      }
    ]
  },
  {
    "id": "cerebras",
    "alias": "cerebras",
    "name": "Cerebras",
    "color": "#FF4F00",
    "textIcon": "CB",
    "icon": "cerebras",
    "website": "https://www.cerebras.ai",
    "notice": "",
    "apiKeyUrl": "https://cloud.cerebras.ai/platform",
    "format": "openai",
    "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gpt-oss-120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "zai-glm-4.7",
        "name": "ZAI GLM 4.7"
      },
      {
        "id": "llama-3.3-70b",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "llama-4-scout-17b-16e-instruct",
        "name": "Llama 4 Scout"
      },
      {
        "id": "qwen-3-235b-a22b-instruct-2507",
        "name": "Qwen3 235B A22B"
      },
      {
        "id": "qwen-3-32b",
        "name": "Qwen3 32B"
      }
    ]
  },
  {
    "id": "chutes",
    "alias": "chutes",
    "name": "Chutes AI",
    "color": "#ffffffff",
    "textIcon": "CH",
    "icon": "chutes",
    "website": "https://chutes.ai",
    "notice": "",
    "apiKeyUrl": "https://chutes.ai/app/api",
    "format": "openai",
    "baseUrl": "https://llm.chutes.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": []
  },
  {
    "id": "clinepass",
    "alias": "clinepass",
    "name": "ClinePass",
    "color": "#5B9BD5",
    "textIcon": "CP",
    "icon": "clinepass",
    "website": "https://cline.bot",
    "notice": "",
    "apiKeyUrl": "https://cline.bot",
    "format": "openai",
    "baseUrl": "https://api.cline.bot/api/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "cline-pass/glm-5.2",
        "name": "GLM-5.2 (ClinePass)"
      },
      {
        "id": "cline-pass/kimi-k2.7-code",
        "name": "Kimi K2.7 Code (ClinePass)"
      },
      {
        "id": "cline-pass/kimi-k2.6",
        "name": "Kimi K2.6 (ClinePass)"
      },
      {
        "id": "cline-pass/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro (ClinePass)"
      },
      {
        "id": "cline-pass/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash (ClinePass)"
      },
      {
        "id": "cline-pass/mimo-v2.5",
        "name": "MiMo-V2.5 (ClinePass)"
      },
      {
        "id": "cline-pass/mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro (ClinePass)"
      },
      {
        "id": "cline-pass/minimax-m3",
        "name": "MiniMax M3 (ClinePass)"
      },
      {
        "id": "cline-pass/qwen3.7-max",
        "name": "Qwen3.7 Max (ClinePass)"
      },
      {
        "id": "cline-pass/qwen3.7-plus",
        "name": "Qwen3.7 Plus (ClinePass)"
      }
    ]
  },
  {
    "id": "cloudflare-ai",
    "alias": "cloudflare-ai",
    "name": "Cloudflare",
    "color": "#F38020",
    "textIcon": "CF",
    "icon": "cloudflare-ai",
    "website": "https://developers.cloudflare.com/workers-ai/",
    "notice": "Workers AI free tier. Requires a Cloudflare API token and Account ID.",
    "apiKeyUrl": "https://dash.cloudflare.com/profile/api-tokens",
    "format": "openai",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "@cf/cloudflare/clef-flash",
        "name": "Clef Flash"
      },
      {
        "id": "@cf/meta/llama-3.2-1b-instruct",
        "name": "Llama 3.2 1B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.2-3b-instruct",
        "name": "Llama 3.2 3B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
        "name": "Llama 3.1 8B Instruct FP8 Fast"
      },
      {
        "id": "@cf/meta/llama-3.1-8b-instruct-awq",
        "name": "Llama 3.1 8B Instruct AWQ"
      },
      {
        "id": "@cf/mistralai/mistral-small-3.1-24b-instruct",
        "name": "Mistral Small 3.1 24B Instruct"
      },
      {
        "id": "@cf/meta/llama-3.1-70b-instruct-fp8-fast",
        "name": "Llama 3.1 70B Instruct FP8 Fast"
      },
      {
        "id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "name": "Llama 3.3 70B Instruct FP8 Fast"
      },
      {
        "id": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        "name": "DeepSeek R1 Distill Qwen 32B"
      },
      {
        "id": "@cf/moonshotai/kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "@cf/moonshotai/kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "@cf/zai-org/glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      },
      {
        "id": "@cf/qwen/qwq-32b",
        "name": "QwQ 32B"
      },
      {
        "id": "@cf/qwen/qwen2.5-coder-32b-instruct",
        "name": "Qwen 2.5 Coder 32B Instruct"
      },
      {
        "id": "@cf/black-forest-labs/flux-2-klein-9b",
        "name": "FLUX.2 Klein 9B"
      },
      {
        "id": "@cf/black-forest-labs/flux-2-klein-4b",
        "name": "FLUX.2 Klein 4B"
      },
      {
        "id": "@cf/black-forest-labs/flux-2-dev",
        "name": "FLUX.2 Dev"
      },
      {
        "id": "@cf/leonardo/lucid-origin",
        "name": "Lucid Origin"
      },
      {
        "id": "@cf/leonardo/phoenix-1.0",
        "name": "Phoenix 1.0"
      },
      {
        "id": "@cf/black-forest-labs/flux-1-schnell",
        "name": "FLUX.1 Schnell"
      },
      {
        "id": "@cf/bytedance/stable-diffusion-xl-lightning",
        "name": "SDXL Lightning"
      },
      {
        "id": "@cf/lykon/dreamshaper-8-lcm",
        "name": "DreamShaper 8 LCM"
      },
      {
        "id": "@cf/runwayml/stable-diffusion-v1-5-img2img",
        "name": "Stable Diffusion v1.5 Img2Img"
      },
      {
        "id": "@cf/runwayml/stable-diffusion-v1-5-inpainting",
        "name": "Stable Diffusion v1.5 Inpainting"
      },
      {
        "id": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        "name": "SDXL Base 1.0"
      }
    ]
  },
  {
    "id": "codebuddy-cn",
    "alias": "cbcn",
    "name": "CodeBuddy CN",
    "color": "#006EFF",
    "textIcon": "CO",
    "icon": "codebuddy-cn",
    "website": "https://copilot.tencent.com",
    "notice": "",
    "apiKeyUrl": "https://copilot.tencent.com",
    "format": "openai",
    "baseUrl": "https://copilot.tencent.com/v2/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "glm-5.2",
        "name": "GLM-5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM-5.1"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax-M3"
      },
      {
        "id": "hy3",
        "name": "Hy3"
      },
      {
        "id": "hy4-preview",
        "name": "Hy4-Preview"
      },
      {
        "id": "glm-5.3",
        "name": "GLM-5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM-5.3-Flash"
      },
      {
        "id": "kimi-k3-1",
        "name": "Kimi-K3"
      },
      {
        "id": "kimi-k2.8-preview",
        "name": "Kimi-K2.8-Preview"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek-V4.1-Flash"
      }
    ]
  },
  {
    "id": "cohere",
    "alias": "cohere",
    "name": "Cohere",
    "color": "#39594D",
    "textIcon": "CO",
    "icon": "cohere",
    "website": "https://cohere.com",
    "notice": "",
    "apiKeyUrl": "https://dashboard.cohere.com/api-keys",
    "format": "openai",
    "baseUrl": "https://api.cohere.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "command-r-plus-08-2024",
        "name": "Command R+ (Aug 2024)"
      },
      {
        "id": "command-r-08-2024",
        "name": "Command R (Aug 2024)"
      },
      {
        "id": "command-a-03-2025",
        "name": "Command A (Mar 2025)"
      }
    ]
  },
  {
    "id": "commandcode",
    "alias": "commandcode",
    "name": "Command Code",
    "color": "#000000",
    "textIcon": "CC",
    "icon": "commandcode",
    "website": "https://commandcode.ai",
    "notice": "Use your CommandCode CLI API key (starts with user_...) from ~/.commandcode/auth.json or commandcode.ai/studio.",
    "apiKeyUrl": "https://commandcode.ai/studio",
    "format": "commandcode",
    "baseUrl": "https://api.commandcode.ai/alpha/generate",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "moonshotai/Kimi-K2.7-Code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "moonshotai/Kimi-K2.7-Code-Highspeed",
        "name": "Kimi K2.7 Code HighSpeed"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "zai-org/GLM-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "zai-org/GLM-5.2-Fast",
        "name": "GLM 5.2 Fast"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "zai-org/GLM-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMaxAI/MiniMax-M3",
        "name": "MiniMax M3"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "xiaomi/mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "xiaomi/mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "Qwen/Qwen3.6-Max-Preview",
        "name": "Qwen 3.6 Max Preview"
      },
      {
        "id": "Qwen/Qwen3.6-Plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "Qwen/Qwen3.7-Max",
        "name": "Qwen 3.7 Max"
      },
      {
        "id": "Qwen/Qwen3.7-Plus",
        "name": "Qwen 3.7 Plus"
      },
      {
        "id": "stepfun/Step-3.7-Flash",
        "name": "Step 3.7 Flash"
      },
      {
        "id": "stepfun/Step-3.5-Flash",
        "name": "Step 3.5 Flash"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron 3 Ultra"
      }
    ]
  },
  {
    "id": "deepseek",
    "alias": "deepseek",
    "name": "DeepSeek",
    "color": "#4D6BFE",
    "textIcon": "DS",
    "icon": "deepseek",
    "website": "https://deepseek.com",
    "notice": "",
    "apiKeyUrl": "https://platform.deepseek.com/api_keys",
    "format": "openai",
    "baseUrl": "https://api.deepseek.com/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-pro-max",
        "name": "DeepSeek V4 Pro Max"
      },
      {
        "id": "deepseek-v4-pro-none",
        "name": "DeepSeek V4 Pro No Thinking"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision (Exp)"
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek V3.2 Chat"
      },
      {
        "id": "deepseek-reasoner",
        "name": "DeepSeek V3.2 Reasoner"
      }
    ]
  },
  {
    "id": "featherless",
    "alias": "featherless",
    "name": "Featherless",
    "color": "#111827",
    "textIcon": "FL",
    "icon": "featherless",
    "website": "https://featherless.ai",
    "notice": "",
    "apiKeyUrl": "https://featherless.ai/account/api-keys",
    "format": "openai",
    "baseUrl": "https://api.featherless.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "zai-org/GLM-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "moonshotai/Kimi-K2.7-Code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      }
    ]
  },
  {
    "id": "fireworks",
    "alias": "fireworks",
    "name": "Fireworks AI",
    "color": "#7B2EF2",
    "textIcon": "FW",
    "icon": "fireworks",
    "website": "https://fireworks.ai",
    "notice": "",
    "apiKeyUrl": "https://fireworks.ai/account/api-keys",
    "format": "openai",
    "baseUrl": "https://api.fireworks.ai/inference/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "accounts/fireworks/models/deepseek-v3p1",
        "name": "DeepSeek V3.1"
      },
      {
        "id": "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "accounts/fireworks/models/qwen3-235b-a22b",
        "name": "Qwen3 235B"
      },
      {
        "id": "nomic-ai/nomic-embed-text-v1.5",
        "name": "Nomic Embed Text v1.5"
      }
    ]
  },
  {
    "id": "gemini",
    "alias": "gemini",
    "name": "Gemini",
    "color": "#4285F4",
    "textIcon": "GE",
    "icon": "gemini",
    "website": "https://ai.google.dev",
    "notice": "",
    "apiKeyUrl": "https://aistudio.google.com/app/apikey",
    "format": "gemini",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/models",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gemini-4-argon",
        "name": "Gemini 4 Argon"
      },
      {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash"
      },
      {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash"
      },
      {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro Preview"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite Preview"
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview"
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro"
      },
      {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash"
      },
      {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash Lite"
      },
      {
        "id": "gemma-4-31b-it",
        "name": "Gemma 4 31B IT"
      },
      {
        "id": "gemini-embedding-2-preview",
        "name": "Gemini Embedding 2 Preview"
      },
      {
        "id": "gemini-embedding-001",
        "name": "Gemini Embedding 001"
      },
      {
        "id": "text-embedding-005",
        "name": "Text Embedding 005"
      },
      {
        "id": "text-embedding-004",
        "name": "Text Embedding 004 (Legacy)"
      },
      {
        "id": "gemini-3.1-flash-image-preview",
        "name": "Gemini 3.1 Flash Image (Nano Banana 2)"
      },
      {
        "id": "gemini-3-pro-image-preview",
        "name": "Gemini 3 Pro Image (Nano Banana Pro)"
      },
      {
        "id": "gemini-2.5-flash-image",
        "name": "Gemini 2.5 Flash Image (Nano Banana)"
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro (Best)"
      },
      {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash"
      },
      {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash Lite (Cheapest)"
      },
      {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash"
      },
      {
        "id": "gemini-2.5-flash-native-audio-preview-09-17",
        "name": "Gemini Live Transcription (Realtime)"
      },
      {
        "id": "gemini-3.1-flash-tts-preview",
        "name": "Gemini 3.1 Flash TTS"
      },
      {
        "id": "gemini-2.5-flash-preview-tts",
        "name": "Gemini 2.5 Flash TTS"
      },
      {
        "id": "gemini-2.5-pro-preview-tts",
        "name": "Gemini 2.5 Pro TTS"
      },
      {
        "id": "embedding-001",
        "name": "Embedding 001"
      }
    ]
  },
  {
    "id": "glm-cn",
    "alias": "glm-cn",
    "name": "GLM (China)",
    "color": "#DC2626",
    "textIcon": "GC",
    "icon": "glm-cn",
    "website": "https://open.bigmodel.cn",
    "notice": "",
    "apiKeyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "format": "openai",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM-4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      },
      {
        "id": "glm-4.6",
        "name": "GLM-4.6"
      },
      {
        "id": "glm-4.5-air",
        "name": "GLM-4.5-Air"
      }
    ]
  },
  {
    "id": "glm",
    "alias": "glm",
    "name": "Zai GLM Coding",
    "color": "#2563EB",
    "textIcon": "GL",
    "icon": "glm",
    "website": "https://open.bigmodel.cn",
    "notice": "",
    "apiKeyUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "format": "openai",
    "baseUrl": "https://api.z.ai/api/coding/paas/v4/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5-turbo",
        "name": "GLM 5 Turbo"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "glm-4.6v",
        "name": "GLM 4.6V (Vision)"
      }
    ]
  },
  {
    "id": "groq",
    "alias": "groq",
    "name": "Groq",
    "color": "#F55036",
    "textIcon": "GQ",
    "icon": "groq",
    "website": "https://groq.com",
    "notice": "",
    "apiKeyUrl": "https://console.groq.com/keys",
    "format": "openai",
    "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "name": "Llama 4 Maverick"
      },
      {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT-OSS 120B"
      },
      {
        "id": "whisper-large-v3",
        "name": "Whisper Large v3"
      },
      {
        "id": "whisper-large-v3-turbo",
        "name": "Whisper Large v3 Turbo"
      },
      {
        "id": "distil-whisper-large-v3-en",
        "name": "Distil Whisper Large v3 EN"
      }
    ]
  },
  {
    "id": "hyperbolic",
    "alias": "hyperbolic",
    "name": "Hyperbolic",
    "color": "#00D4FF",
    "textIcon": "HY",
    "icon": "hyperbolic",
    "website": "https://hyperbolic.xyz",
    "notice": "",
    "apiKeyUrl": "https://app.hyperbolic.xyz/settings",
    "format": "openai",
    "baseUrl": "https://api.hyperbolic.xyz/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "Qwen/QwQ-32B",
        "name": "QwQ 32B"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3",
        "name": "DeepSeek V3"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "meta-llama/Llama-3.2-3B-Instruct",
        "name": "Llama 3.2 3B"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen 2.5 72B"
      },
      {
        "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "name": "Qwen 2.5 Coder 32B"
      },
      {
        "id": "NousResearch/Hermes-3-Llama-3.1-70B",
        "name": "Hermes 3 70B"
      }
    ]
  },
  {
    "id": "kimchi",
    "alias": "kimchi",
    "name": "Kimchi",
    "color": "#FF521D",
    "textIcon": "KC",
    "icon": "kimchi",
    "website": "https://kimchi.dev",
    "notice": "",
    "apiKeyUrl": "https://kimchi.dev",
    "format": "openai",
    "baseUrl": "https://llm.kimchi.dev/openai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "minimax-m3",
        "name": "MiniMax-M3"
      },
      {
        "id": "kimi-k2.7",
        "name": "Kimi-K2.7"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi-K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi-K2.5"
      },
      {
        "id": "nemotron-3-ultra-fp4",
        "name": "Nemotron 3 Ultra FP4"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6"
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      }
    ]
  },
  {
    "id": "kimi",
    "alias": "kimi",
    "name": "Kimi",
    "color": "#1E3A8A",
    "textIcon": "KM",
    "icon": "kimi",
    "website": "https://kimi.moonshot.cn",
    "notice": "",
    "apiKeyUrl": "https://platform.moonshot.ai/console/api-keys",
    "format": "openai",
    "baseUrl": "https://api.kimi.com/coding/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "k3",
        "name": "Kimi K3 (Code)"
      },
      {
        "id": "kimi-for-coding",
        "name": "Kimi for Coding"
      },
      {
        "id": "kimi-for-coding-highspeed",
        "name": "Kimi for Coding Highspeed"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.7-code-highspeed",
        "name": "Kimi K2.7 Code Highspeed"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "kimi-k2.5-thinking",
        "name": "Kimi K2.5 Thinking"
      },
      {
        "id": "kimi-latest",
        "name": "Kimi Latest"
      }
    ]
  },
  {
    "id": "minimax-cn",
    "alias": "minimax-cn",
    "name": "Minimax (China)",
    "color": "#DC2626",
    "textIcon": "MC",
    "icon": "minimax-cn",
    "website": "https://www.minimaxi.com",
    "notice": "",
    "apiKeyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "format": "openai",
    "baseUrl": "https://api.minimaxi.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3"
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMax-M2.1",
        "name": "MiniMax M2.1"
      },
      {
        "id": "speech-2.8-hd",
        "name": "Speech 2.8 HD"
      },
      {
        "id": "speech-2.8-turbo",
        "name": "Speech 2.8 Turbo"
      },
      {
        "id": "speech-2.6-hd",
        "name": "Speech 2.6 HD"
      },
      {
        "id": "speech-2.6-turbo",
        "name": "Speech 2.6 Turbo"
      },
      {
        "id": "speech-02-hd",
        "name": "Speech 02 HD"
      },
      {
        "id": "speech-02-turbo",
        "name": "Speech 02 Turbo"
      },
      {
        "id": "speech-01-hd",
        "name": "Speech 01 HD"
      },
      {
        "id": "speech-01-turbo",
        "name": "Speech 01 Turbo"
      }
    ]
  },
  {
    "id": "minimax",
    "alias": "minimax",
    "name": "Minimax Coding",
    "color": "#7C3AED",
    "textIcon": "MM",
    "icon": "minimax",
    "website": "https://www.minimaxi.com",
    "notice": "",
    "apiKeyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "format": "openai",
    "baseUrl": "https://api.minimax.io/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3"
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMax-M2.1",
        "name": "MiniMax M2.1"
      },
      {
        "id": "minimax-image-01",
        "name": "MiniMax Image 01"
      },
      {
        "id": "speech-2.8-hd",
        "name": "Speech 2.8 HD"
      },
      {
        "id": "speech-2.8-turbo",
        "name": "Speech 2.8 Turbo"
      },
      {
        "id": "speech-2.6-hd",
        "name": "Speech 2.6 HD"
      },
      {
        "id": "speech-2.6-turbo",
        "name": "Speech 2.6 Turbo"
      },
      {
        "id": "speech-02-hd",
        "name": "Speech 02 HD"
      },
      {
        "id": "speech-02-turbo",
        "name": "Speech 02 Turbo"
      },
      {
        "id": "speech-01-hd",
        "name": "Speech 01 HD"
      },
      {
        "id": "speech-01-turbo",
        "name": "Speech 01 Turbo"
      }
    ]
  },
  {
    "id": "mistral",
    "alias": "mistral",
    "name": "Mistral",
    "color": "#FF7000",
    "textIcon": "MI",
    "icon": "mistral",
    "website": "https://mistral.ai",
    "notice": "",
    "apiKeyUrl": "https://console.mistral.ai/api-keys",
    "format": "openai",
    "baseUrl": "https://api.mistral.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "mistral-large-latest",
        "name": "Mistral Large 3"
      },
      {
        "id": "codestral-latest",
        "name": "Codestral"
      },
      {
        "id": "mistral-medium-latest",
        "name": "Mistral Medium 3"
      },
      {
        "id": "mistral-embed",
        "name": "Mistral Embed"
      }
    ]
  },
  {
    "id": "mmf",
    "alias": "mmf",
    "name": "MMF",
    "color": "#6366F1",
    "textIcon": "MF",
    "icon": "mmf",
    "website": "",
    "notice": "",
    "apiKeyUrl": "",
    "format": "openai",
    "baseUrl": "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "mimo-auto",
        "name": "MiMo Auto"
      }
    ]
  },
  {
    "id": "nebius",
    "alias": "nebius",
    "name": "Nebius AI",
    "color": "#6C5CE7",
    "textIcon": "NB",
    "icon": "nebius",
    "website": "https://nebius.com",
    "notice": "",
    "apiKeyUrl": "https://studio.nebius.com/settings/api-keys",
    "format": "openai",
    "baseUrl": "https://api.studio.nebius.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B Instruct"
      },
      {
        "id": "Qwen/Qwen3-Embedding-8B",
        "name": "Qwen3 Embedding 8B"
      }
    ]
  },
  {
    "id": "nvidia",
    "alias": "nvidia",
    "name": "NVIDIA NIM",
    "color": "#76B900",
    "textIcon": "NV",
    "icon": "nvidia",
    "website": "https://developer.nvidia.com/nim",
    "notice": "Free access for NVIDIA Developer Program members (prototyping & testing).",
    "apiKeyUrl": "https://build.nvidia.com/settings/api-keys",
    "format": "openai",
    "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "minimaxai/minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimaxai/minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "z-ai/glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "deepseek-ai/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron 3 Ultra"
      },
      {
        "id": "nvidia/nv-embedqa-e5-v5",
        "name": "NV EmbedQA E5 v5"
      },
      {
        "id": "nvidia/parakeet-ctc-1.1b-asr",
        "name": "Parakeet CTC 1.1B"
      },
      {
        "id": "fastpitch",
        "name": "FastPitch"
      },
      {
        "id": "tacotron2",
        "name": "Tacotron2"
      }
    ]
  },
  {
    "id": "ollama-local",
    "alias": "ollama-local",
    "name": "Ollama Local",
    "color": "#ffffffff",
    "textIcon": "OL",
    "icon": "ollama-local",
    "website": "https://ollama.com",
    "notice": "",
    "apiKeyUrl": "https://ollama.com",
    "format": "ollama",
    "baseUrl": "http://localhost:11434/api/chat",
    "modelsFetcherUrl": "",
    "models": []
  },
  {
    "id": "ollama",
    "alias": "ollama",
    "name": "Ollama Cloud",
    "color": "#ffffffff",
    "textIcon": "OL",
    "icon": "ollama",
    "website": "https://ollama.com",
    "notice": "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.",
    "apiKeyUrl": "https://ollama.com/settings/keys",
    "format": "ollama",
    "baseUrl": "https://ollama.com/api/chat",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gpt-oss:120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      },
      {
        "id": "qwen3.5",
        "name": "Qwen3.5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "deepseek-v4.1-flash:cloud",
        "name": "DeepSeek V4.1 Flash"
      }
    ]
  },
  {
    "id": "qoder-cn",
    "alias": "qdcn",
    "name": "Qoder CN",
    "color": "#EC4899",
    "textIcon": "QO",
    "icon": "qoder-cn",
    "website": "https://qoder.com.cn",
    "notice": "",
    "apiKeyUrl": "https://qoder.com.cn",
    "format": "openai",
    "baseUrl": "https://gateway.qoder.com.cn/algo/api/v2/service/pro/sse/agent_chat_generation",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "ultimate",
        "name": "Ultimate"
      },
      {
        "id": "auto",
        "name": "Auto"
      },
      {
        "id": "performance",
        "name": "Performance"
      },
      {
        "id": "efficient",
        "name": "Efficient"
      },
      {
        "id": "lite",
        "name": "Lite"
      },
      {
        "id": "qmodel_38max",
        "name": "Qwen3.8-Max"
      },
      {
        "id": "qmodel_latest",
        "name": "Qwen3.7-Max"
      },
      {
        "id": "qmodel",
        "name": "Qwen3.7-Plus"
      },
      {
        "id": "qfmodel",
        "name": "Qwen3.8-Flash"
      },
      {
        "id": "kmodel_latest",
        "name": "Kimi-K3"
      },
      {
        "id": "kmodel",
        "name": "Kimi-K2.7-Code"
      },
      {
        "id": "gmodel",
        "name": "GLM-5.3"
      },
      {
        "id": "gfmodel",
        "name": "GLM-5.3-Flash"
      },
      {
        "id": "dmodel",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "dfmodel",
        "name": "DeepSeek-V4-Flash"
      },
      {
        "id": "mmodel",
        "name": "MiniMax-M3"
      }
    ]
  },
  {
    "id": "openai",
    "alias": "openai",
    "name": "OpenAI",
    "color": "#10A37F",
    "textIcon": "OA",
    "icon": "openai",
    "website": "https://platform.openai.com",
    "notice": "",
    "apiKeyUrl": "https://platform.openai.com/api-keys",
    "format": "openai",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "gpt-5.2",
        "name": "GPT-5.2"
      },
      {
        "id": "gpt-5.1",
        "name": "GPT-5.1"
      },
      {
        "id": "gpt-5",
        "name": "GPT-5"
      },
      {
        "id": "gpt-5-mini",
        "name": "GPT-5 Mini"
      },
      {
        "id": "gpt-5-nano",
        "name": "GPT-5 Nano"
      },
      {
        "id": "gpt-4o",
        "name": "GPT-4o"
      },
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini"
      },
      {
        "id": "gpt-4-turbo",
        "name": "GPT-4 Turbo"
      },
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1"
      },
      {
        "id": "gpt-4.1-mini",
        "name": "GPT-4.1 Mini"
      },
      {
        "id": "gpt-4.1-nano",
        "name": "GPT-4.1 Nano"
      },
      {
        "id": "o3",
        "name": "O3"
      },
      {
        "id": "o3-mini",
        "name": "O3 Mini"
      },
      {
        "id": "o3-pro",
        "name": "O3 Pro"
      },
      {
        "id": "o4-mini",
        "name": "O4 Mini"
      },
      {
        "id": "o1",
        "name": "O1"
      },
      {
        "id": "o1-mini",
        "name": "O1 Mini"
      },
      {
        "id": "text-embedding-3-large",
        "name": "Text Embedding 3 Large"
      },
      {
        "id": "text-embedding-3-small",
        "name": "Text Embedding 3 Small"
      },
      {
        "id": "text-embedding-ada-002",
        "name": "Text Embedding Ada 002"
      },
      {
        "id": "tts-1",
        "name": "TTS-1"
      },
      {
        "id": "tts-1-hd",
        "name": "TTS-1 HD"
      },
      {
        "id": "gpt-4o-mini-tts",
        "name": "GPT-4o Mini TTS"
      },
      {
        "id": "whisper-1",
        "name": "Whisper 1"
      },
      {
        "id": "gpt-4o-transcribe",
        "name": "GPT-4o Transcribe"
      },
      {
        "id": "gpt-4o-mini-transcribe",
        "name": "GPT-4o Mini Transcribe"
      },
      {
        "id": "gpt-image-2.5",
        "name": "GPT Image 2.5"
      },
      {
        "id": "gpt-image-2.5-flare",
        "name": "GPT Image 2.5 Flare"
      },
      {
        "id": "gpt-image-2.5-sunburst",
        "name": "GPT Image 2.5 Sunburst"
      },
      {
        "id": "gpt-image-1",
        "name": "GPT Image 1"
      },
      {
        "id": "dall-e-3",
        "name": "DALL-E 3"
      },
      {
        "id": "dall-e-2",
        "name": "DALL-E 2"
      }
    ]
  },
  {
    "id": "opencode-go",
    "alias": "opencode-go",
    "name": "OpenCode Go",
    "color": "#E87040",
    "textIcon": "OC",
    "icon": "opencode-go",
    "website": "https://opencode.ai/auth",
    "notice": "OpenCode Go subscription: $5/mo (then 10/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
    "apiKeyUrl": "https://opencode.ai/auth",
    "format": "openai",
    "baseUrl": "https://opencode.ai/zen/go/v1/chat/completions",
    "modelsFetcherUrl": "https://opencode.ai/zen/go/v1/models",
    "models": [
      {
        "id": "deepseek-flash",
        "name": "DeepSeek Flash"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision (Exp)"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek V4.1 Flash"
      },
      {
        "id": "longcat-2.0",
        "name": "LongCat 2.0"
      },
      {
        "id": "mimo-v2.6-flash",
        "name": "MiMo V2.6 Flash"
      },
      {
        "id": "mimo-v2.6-pro",
        "name": "MiMo V2.6 Pro"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "mimo-v2-pro",
        "name": "MiMo V2 Pro"
      },
      {
        "id": "mimo-v2-omni",
        "name": "MiMo V2 Omni"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "space-bunny-free",
        "name": "Space Bunny Free"
      },
      {
        "id": "qwen3.8-max",
        "name": "Qwen 3.8 Max"
      },
      {
        "id": "qwen3.8-flash",
        "name": "Qwen 3.8 Flash"
      },
      {
        "id": "qwen3.7-max",
        "name": "Qwen 3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen 3.7 Plus"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "qwen3.5-plus",
        "name": "Qwen 3.5 Plus"
      },
      {
        "id": "hy4-preview",
        "name": "Hy4 Preview"
      },
      {
        "id": "hy3",
        "name": "Hy3"
      },
      {
        "id": "hy3-preview",
        "name": "Hy3 Preview"
      },
      {
        "id": "omen-alpha",
        "name": "Omen Alpha"
      },
      {
        "id": "grok-4.7",
        "name": "Grok 4.7"
      },
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5"
      },
      {
        "id": "gpt-5.6-luna",
        "name": "GPT 5.6 Luna"
      },
      {
        "id": "gpt-6-luna",
        "name": "GPT 6 Luna"
      },
      {
        "id": "muse-spark-1.2-contributor",
        "name": "Muse Spark 1.2 Contributor"
      },
      {
        "id": "muse-spark-1.3-contributor",
        "name": "Muse Spark 1.3 Contributor"
      },
      {
        "id": "claude-haiku-5-5",
        "name": "Claude Haiku 5.5"
      }
    ]
  },
  {
    "id": "opencode-zen",
    "alias": "ocz",
    "name": "OpenCode Zen",
    "color": "#E87040",
    "textIcon": "OZ",
    "icon": "opencode-zen",
    "website": "https://opencode.ai/auth",
    "notice": "OpenCode Zen PAYG: pay-as-you-go, key from https://opencode.ai/auth. Same models as Zen: paid + free tiers on the fast lane.",
    "apiKeyUrl": "https://opencode.ai/auth",
    "format": "openai",
    "baseUrl": "https://opencode.ai/zen/v1/chat/completions",
    "modelsFetcherUrl": "https://opencode.ai/zen/v1/models",
    "models": [
      {
        "id": "claude-fable-5",
        "name": "Claude Fable 5"
      },
      {
        "id": "claude-fable-5-1",
        "name": "Claude Fable 5.1"
      },
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5"
      },
      {
        "id": "claude-opus-4-8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "claude-opus-4-7",
        "name": "Claude Opus 4.7"
      },
      {
        "id": "claude-opus-4-6",
        "name": "Claude Opus 4.6"
      },
      {
        "id": "claude-opus-4-5",
        "name": "Claude Opus 4.5"
      },
      {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5"
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "claude-sonnet-4-5",
        "name": "Claude Sonnet 4.5"
      },
      {
        "id": "claude-sonnet-4",
        "name": "Claude Sonnet 4"
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash"
      },
      {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash"
      },
      {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite"
      },
      {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash"
      },
      {
        "id": "gemini-3.1-pro",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "gemini-3-flash",
        "name": "Gemini 3 Flash"
      },
      {
        "id": "gpt-6-astra",
        "name": "GPT 6 Astra"
      },
      {
        "id": "gpt-5.6-sol",
        "name": "GPT 5.6 Sol"
      },
      {
        "id": "gpt-5.6-terra",
        "name": "GPT 5.6 Terra"
      },
      {
        "id": "gpt-5.6-luna",
        "name": "GPT 5.6 Luna"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT 5.5"
      },
      {
        "id": "gpt-5.5-pro",
        "name": "GPT 5.5 Pro"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT 5.4"
      },
      {
        "id": "gpt-5.4-pro",
        "name": "GPT 5.4 Pro"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT 5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT 5.4 Nano"
      },
      {
        "id": "gpt-5.3-codex-spark",
        "name": "GPT 5.3 Codex Spark"
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT 5.3 Codex"
      },
      {
        "id": "gpt-5.2",
        "name": "GPT 5.2"
      },
      {
        "id": "gpt-5.2-codex",
        "name": "GPT 5.2 Codex"
      },
      {
        "id": "gpt-5.1",
        "name": "GPT 5.1"
      },
      {
        "id": "gpt-5.1-codex-max",
        "name": "GPT 5.1 Codex Max"
      },
      {
        "id": "gpt-5.1-codex",
        "name": "GPT 5.1 Codex"
      },
      {
        "id": "gpt-5.1-codex-mini",
        "name": "GPT 5.1 Codex Mini"
      },
      {
        "id": "gpt-5",
        "name": "GPT 5"
      },
      {
        "id": "gpt-5-codex",
        "name": "GPT 5 Codex"
      },
      {
        "id": "gpt-5-nano",
        "name": "GPT 5 Nano"
      },
      {
        "id": "grok-build-0.1",
        "name": "Grok Build 0.1"
      },
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5"
      },
      {
        "id": "muse-spark-1.3",
        "name": "Muse Spark 1.3"
      },
      {
        "id": "muse-spark-1.2",
        "name": "Muse Spark 1.2"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "qwen3.5-plus",
        "name": "Qwen 3.5 Plus"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-v4-flash-vision-exp",
        "name": "DeepSeek V4 Flash Vision Exp"
      },
      {
        "id": "glm-5.3-flash",
        "name": "GLM 5.3 Flash (Vision)"
      },
      {
        "id": "glm-5.3",
        "name": "GLM 5.3"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "big-pickle",
        "name": "Big Pickle"
      },
      {
        "id": "union-alpha",
        "name": "Union Alpha"
      },
      {
        "id": "deepseek-v4-flash-free",
        "name": "DeepSeek V4 Flash Free"
      },
      {
        "id": "mimo-v2.6-flash-free",
        "name": "MiMo V2.6 Flash Free"
      },
      {
        "id": "mimo-v2.5-free",
        "name": "MiMo V2.5 Free"
      },
      {
        "id": "ling-3.0-flash-fin-free",
        "name": "Ling 3.0 Flash Fin Free"
      },
      {
        "id": "nemotron-3-ultra-free",
        "name": "Nemotron 3 Ultra Free"
      },
      {
        "id": "nemotron-3.5-lightning-free",
        "name": "Nemotron 3.5 Lightning Free"
      },
      {
        "id": "muse-spark-1.3-contributor-free",
        "name": "Muse Spark 1.3 Contributor Free"
      },
      {
        "id": "muse-spark-1.2-contributor-free",
        "name": "Muse Spark 1.2 Contributor Free"
      },
      {
        "id": "jev-1.13",
        "name": "Jev 1.13"
      },
      {
        "id": "jev-1.13-free",
        "name": "Jev 1.13 Free"
      }
    ]
  },
  {
    "id": "openrouter",
    "alias": "openrouter",
    "name": "OpenRouter",
    "color": "#F97316",
    "textIcon": "OR",
    "icon": "openrouter",
    "website": "https://openrouter.ai",
    "notice": "Free tier: 27+ free models, no credit card needed, 200 req/day. After  0 credit: 1,000 req/day.",
    "apiKeyUrl": "https://openrouter.ai/settings/keys",
    "format": "openai",
    "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
    "modelsFetcherUrl": "https://openrouter.ai/api/v1/models",
    "models": [
      {
        "id": "openai/text-embedding-3-large",
        "name": "OpenAI Text Embedding 3 Large"
      },
      {
        "id": "openai/text-embedding-3-small",
        "name": "OpenAI Text Embedding 3 Small"
      },
      {
        "id": "openai/text-embedding-ada-002",
        "name": "OpenAI Text Embedding Ada 002"
      },
      {
        "id": "qwen/qwen3-embedding-8b",
        "name": "Qwen3 Embedding 8B"
      },
      {
        "id": "perplexity/pplx-embed-v1-4b",
        "name": "Perplexity Embed V1 4B"
      },
      {
        "id": "perplexity/pplx-embed-v1-0.6b",
        "name": "Perplexity Embed V1 0.6B"
      },
      {
        "id": "nvidia/llama-nemotron-embed-vl-1b-v2:free",
        "name": "NVIDIA Nemotron Embed VL 1B V2 (Free)"
      },
      {
        "id": "openai/gpt-4o-mini-tts",
        "name": "GPT-4o Mini TTS"
      },
      {
        "id": "openai/tts-1-hd",
        "name": "TTS-1 HD"
      },
      {
        "id": "openai/tts-1",
        "name": "TTS-1"
      },
      {
        "id": "openai/dall-e-3",
        "name": "DALL-E 3 (via OpenRouter)"
      },
      {
        "id": "openai/gpt-image-1",
        "name": "GPT Image 1 (via OpenRouter)"
      },
      {
        "id": "google/imagen-3.0-generate-002",
        "name": "Imagen 3 (via OpenRouter)"
      },
      {
        "id": "black-forest-labs/FLUX.1-schnell",
        "name": "FLUX.1 Schnell (via OpenRouter)"
      },
      {
        "id": "google/veo-3.1",
        "name": "Veo 3.1 (via OpenRouter)"
      },
      {
        "id": "openai/sora-2-pro",
        "name": "Sora 2 Pro (via OpenRouter)"
      },
      {
        "id": "bytedance/seedance-2.0",
        "name": "Seedance 2.0 (via OpenRouter)"
      },
      {
        "id": "typesafe/jev-1.13",
        "name": "Jev 1.13"
      }
    ]
  },
  {
    "id": "perplexity",
    "alias": "perplexity",
    "name": "Perplexity",
    "color": "#20808D",
    "textIcon": "PP",
    "icon": "perplexity",
    "website": "https://www.perplexity.ai",
    "notice": "",
    "apiKeyUrl": "https://www.perplexity.ai/settings/api",
    "format": "openai",
    "baseUrl": "https://api.perplexity.ai/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "sonar-pro",
        "name": "Sonar Pro"
      },
      {
        "id": "sonar",
        "name": "Sonar"
      }
    ]
  },
  {
    "id": "perplexity-agent",
    "alias": "perplexity-agent",
    "name": "Perplexity Agent",
    "color": "#20808D",
    "textIcon": "PA",
    "icon": "perplexity-agent",
    "website": "https://www.perplexity.ai",
    "notice": "Perplexity Agent API exposes GPT, Claude, Gemini, Grok, GLM, Kimi, and Sonar models through one OpenAI-compatible Responses API.",
    "apiKeyUrl": "https://www.perplexity.ai/settings/api",
    "format": "openai-responses",
    "baseUrl": "https://api.perplexity.ai/v1/responses",
    "modelsFetcherUrl": "https://api.perplexity.ai/v1/models",
    "models": [
      {
        "id": "perplexity/sonar",
        "name": "Perplexity Sonar"
      },
      {
        "id": "openai/gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "openai/gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "openai/gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "anthropic/claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "anthropic/claude-opus-4-8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "google/gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "xai/grok-4.20-reasoning",
        "name": "Grok 4.20 Reasoning"
      },
      {
        "id": "perplexity/glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "perplexity/kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super 120B"
      }
    ]
  },
  {
    "id": "qoder",
    "alias": "qd",
    "name": "Qoder",
    "color": "#EC4899",
    "textIcon": "QO",
    "icon": "qoder",
    "website": "https://qoder.com",
    "notice": "",
    "apiKeyUrl": "https://qoder.com",
    "format": "openai",
    "baseUrl": "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "ultimate",
        "name": "Ultimate"
      },
      {
        "id": "auto",
        "name": "Auto"
      },
      {
        "id": "performance",
        "name": "Performance"
      },
      {
        "id": "efficient",
        "name": "Efficient"
      },
      {
        "id": "lite",
        "name": "Lite"
      },
      {
        "id": "qmodel_38max",
        "name": "Qwen3.8-Max"
      },
      {
        "id": "qmodel_latest",
        "name": "Qwen3.7-Max"
      },
      {
        "id": "qmodel",
        "name": "Qwen3.7-Plus"
      },
      {
        "id": "qfmodel",
        "name": "Qwen3.8-Flash"
      },
      {
        "id": "kmodel_latest",
        "name": "Kimi-K3"
      },
      {
        "id": "kmodel",
        "name": "Kimi-K2.7-Code"
      },
      {
        "id": "gmodel",
        "name": "GLM-5.3"
      },
      {
        "id": "gfmodel",
        "name": "GLM-5.3-Flash"
      },
      {
        "id": "dmodel",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "dfmodel",
        "name": "DeepSeek-V4-Flash"
      },
      {
        "id": "mmodel",
        "name": "MiniMax-M3"
      }
    ]
  },
  {
    "id": "siliconflow",
    "alias": "siliconflow",
    "name": "SiliconFlow",
    "color": "#5B6EF5",
    "textIcon": "SF",
    "icon": "siliconflow",
    "website": "https://cloud.siliconflow.com",
    "notice": "",
    "apiKeyUrl": "https://cloud.siliconflow.com/account/ak",
    "format": "openai",
    "baseUrl": "https://api.siliconflow.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2",
        "name": "DeepSeek V3.2"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2-Exp",
        "name": "DeepSeek V3.2 Exp"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1",
        "name": "DeepSeek V3.1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1-Terminus",
        "name": "DeepSeek V3.1 Terminus"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "Qwen/Qwen3.5-397B-A17B",
        "name": "Qwen 3.5 397B A17B"
      },
      {
        "id": "Qwen/Qwen3.5-122B-A10B",
        "name": "Qwen 3.5 122B A10B"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "zai-org/GLM-5",
        "name": "GLM 5"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "inclusionAI/Ling-flash-2.0",
        "name": "Ling Flash 2.0"
      }
    ]
  },
  {
    "id": "together",
    "alias": "together",
    "name": "Together AI",
    "color": "#0F6FFF",
    "textIcon": "TG",
    "icon": "together",
    "website": "https://www.together.ai",
    "notice": "",
    "apiKeyUrl": "https://api.together.xyz/settings/api-keys",
    "format": "openai",
    "baseUrl": "https://api.together.xyz/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "name": "Llama 3.3 70B Turbo"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B",
        "name": "Qwen3 235B"
      },
      {
        "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "name": "Llama 4 Maverick"
      },
      {
        "id": "BAAI/bge-large-en-v1.5",
        "name": "BGE Large EN v1.5"
      },
      {
        "id": "togethercomputer/m2-bert-80M-8k-retrieval",
        "name": "M2 BERT 80M 8K"
      }
    ]
  },
  {
    "id": "venice",
    "alias": "venice",
    "name": "Venice AI",
    "color": "#DC2626",
    "textIcon": "VE",
    "icon": "venice",
    "website": "https://venice.ai",
    "notice": "OpenAI-compatible. Private inference + uncensored models (Venice Uncensored, GLM, Qwen, DeepSeek, Llama).",
    "apiKeyUrl": "https://venice.ai/settings/api",
    "format": "openai",
    "baseUrl": "https://api.venice.ai/api/v1/chat/completions",
    "modelsFetcherUrl": "https://api.venice.ai/api/v1/models",
    "models": [
      {
        "id": "venice-uncensored-1-2",
        "name": "Venice Uncensored 1.2"
      },
      {
        "id": "zai-org-glm-5",
        "name": "GLM-5"
      },
      {
        "id": "qwen3-235b-a22b-instruct-2507",
        "name": "Qwen3 235B A22B Instruct"
      },
      {
        "id": "qwen3-coder-480b-a35b-instruct-turbo",
        "name": "Qwen3 Coder 480B A35B Turbo"
      },
      {
        "id": "qwen3-vl-235b-a22b",
        "name": "Qwen3 VL 235B A22B"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "llama-3.3-70b",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "hermes-3-llama-3.1-405b",
        "name": "Hermes 3 Llama 3.1 405B"
      },
      {
        "id": "mistral-small-3-2-24b-instruct",
        "name": "Mistral Small 3.2 24B"
      },
      {
        "id": "text-embedding-3-large",
        "name": "Text Embedding 3 Large"
      },
      {
        "id": "text-embedding-bge-m3",
        "name": "BGE-M3 Embedding"
      },
      {
        "id": "text-embedding-qwen3-8b",
        "name": "Qwen3 8B Embedding"
      },
      {
        "id": "venice-sd35",
        "name": "Venice SD3.5"
      },
      {
        "id": "flux-2-pro",
        "name": "FLUX.2 Pro"
      },
      {
        "id": "gpt-image-2",
        "name": "GPT Image 2 (via Venice)"
      }
    ]
  },
  {
    "id": "vercel-ai-gateway",
    "alias": "vercel-ai-gateway",
    "name": "Vercel AI Gateway",
    "color": "#111827",
    "textIcon": "VG",
    "icon": "vercel-ai-gateway",
    "website": "https://vercel.com/ai-gateway",
    "notice": "Unified OpenAI-compatible endpoint from Vercel. Use your AI Gateway API key, then pick models with provider/model IDs like anthropic/claude-sonnet-4.6 or openai/gpt-5.4.",
    "apiKeyUrl": "https://vercel.com/dashboard/~/ai-gateway",
    "format": "openai",
    "baseUrl": "https://ai-gateway.vercel.sh/v1/chat/completions",
    "modelsFetcherUrl": "https://ai-gateway.vercel.sh/v1/models",
    "models": []
  },
  {
    "id": "vertex-partner",
    "alias": "vertex-partner",
    "name": "Vertex Partner",
    "color": "#34A853",
    "textIcon": "VP",
    "icon": "vertex-partner",
    "website": "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models",
    "notice": "",
    "apiKeyUrl": "https://console.cloud.google.com/iam-admin/serviceaccounts",
    "format": "openai",
    "baseUrl": "https://aiplatform.googleapis.com",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek-ai/deepseek-v3.2-maas",
        "name": "DeepSeek V3.2 (Vertex)"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-thinking-maas",
        "name": "Qwen3 Next 80B Thinking (Vertex)"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct-maas",
        "name": "Qwen3 Next 80B Instruct (Vertex)"
      },
      {
        "id": "zai-org/glm-5-maas",
        "name": "GLM-5 (Vertex)"
      }
    ]
  },
  {
    "id": "volcengine-ark",
    "alias": "volcengine-ark",
    "name": "Volcengine Ark",
    "color": "#1677FF",
    "textIcon": "ARK",
    "icon": "volcengine-ark",
    "website": "https://ark.cn-beijing.volces.com",
    "notice": "",
    "apiKeyUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "format": "openai",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "Doubao-Seed-2.0-Code",
        "name": "Doubao-Seed-2.0-Code"
      },
      {
        "id": "Doubao-Seed-2.0-pro",
        "name": "Doubao-Seed-2.0-pro"
      },
      {
        "id": "Doubao-Seed-2.0-lite",
        "name": "Doubao-Seed-2.0-lite"
      },
      {
        "id": "Doubao-Seed-Code",
        "name": "Doubao-Seed-Code"
      },
      {
        "id": "DeepSeek-V4-Flash",
        "name": "DeepSeek-V4-Flash"
      },
      {
        "id": "DeepSeek-V4-Pro",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "GLM-5.1",
        "name": "GLM-5.1"
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "Kimi-K2.6",
        "name": "Kimi-K2.6"
      }
    ]
  },
  {
    "id": "xai",
    "alias": "xai",
    "name": "xAI (Grok)",
    "color": "#1DA1F2",
    "textIcon": "XA",
    "icon": "xai",
    "website": "https://x.ai",
    "notice": "",
    "apiKeyUrl": "https://console.x.ai",
    "format": "openai",
    "baseUrl": "https://api.x.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5"
      },
      {
        "id": "grok-4",
        "name": "Grok 4"
      },
      {
        "id": "grok-4-fast-reasoning",
        "name": "Grok 4 Fast Reasoning"
      },
      {
        "id": "grok-code-fast-1",
        "name": "Grok Code Fast"
      },
      {
        "id": "grok-3",
        "name": "Grok 3"
      },
      {
        "id": "grok-2-image-1212",
        "name": "Grok 2 Image"
      },
      {
        "id": "grok-imagine-video",
        "name": "Grok Imagine Video"
      }
    ]
  },
  {
    "id": "xiaomi-mimo",
    "alias": "xiaomi-mimo",
    "name": "Xiaomi MiMo",
    "color": "#FF6900",
    "textIcon": "XM",
    "icon": "xiaomi-mimo",
    "website": "https://xiaomimimo.com",
    "notice": "",
    "apiKeyUrl": "https://platform.xiaomimimo.com/console/api-keys",
    "format": "openai",
    "baseUrl": "https://api.xiaomimimo.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "mimo-v2.6-pro",
        "name": "MiMo V2.6 Pro"
      },
      {
        "id": "mimo-v2.6-flash",
        "name": "MiMo V2.6 Flash"
      },
      {
        "id": "mimo-v2.6-pro-ultraspeed",
        "name": "MiMo V2.6 Pro UltraSpeed"
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "mimo-v2-omni",
        "name": "MiMo V2 Omni"
      },
      {
        "id": "mimo-v2-flash",
        "name": "MiMo V2 Flash"
      },
      {
        "id": "mimo-v2.5-tts",
        "name": "MiMo V2.5 TTS"
      }
    ]
  },
  {
    "id": "xiaomi-tokenplan",
    "alias": "xiaomi-tokenplan",
    "name": "Xiaomi MiMo (Token Plan)",
    "color": "#FF6700",
    "textIcon": "XT",
    "icon": "xiaomi-tokenplan",
    "website": "https://mimo.xiaomi.com",
    "notice": "Xiaomi MiMo Token Plan subscription (API key starts with tp-). Token Plan keys are cluster-specific — select the region matching your subscription.",
    "apiKeyUrl": "https://mimo.xiaomi.com",
    "format": "openai",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro"
      },
      {
        "id": "mimo-v2.5-pro-claude",
        "name": "MiMo V2.5 Pro (Claude Native)"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo V2.5"
      },
      {
        "id": "mimo-v2-pro",
        "name": "MiMo V2 Pro"
      },
      {
        "id": "mimo-v2-omni",
        "name": "MiMo V2 Omni"
      },
      {
        "id": "mimo-v2-tts",
        "name": "MiMo V2 TTS"
      },
      {
        "id": "mimo-v2.5-tts",
        "name": "MiMo V2.5 TTS"
      },
      {
        "id": "mimo-v2.5-tts-voiceclone",
        "name": "MiMo V2.5 TTS Voice Clone"
      },
      {
        "id": "mimo-v2.5-tts-voicedesign",
        "name": "MiMo V2.5 TTS Voice Design"
      }
    ]
  },
  {
    "id": "alims-intl",
    "alias": "alims-intl",
    "name": "Alibaba Studio",
    "color": "#FF6A00",
    "textIcon": "ALi",
    "icon": "alims-intl",
    "website": "https://modelstudio.console.alibabacloud.com",
    "notice": "",
    "apiKeyUrl": "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    "format": "openai",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen3-coder-plus",
        "name": "Qwen3 Coder Plus"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      }
    ]
  },
  {
    "id": "codebuddy-intl",
    "alias": "cbai",
    "name": "CodeBuddy",
    "color": "#006EFF",
    "textIcon": "CO",
    "icon": "codebuddy-intl",
    "website": "https://www.codebuddy.ai",
    "notice": "",
    "apiKeyUrl": "https://www.codebuddy.ai",
    "format": "openai",
    "baseUrl": "https://www.codebuddy.ai/v2/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "glm-5.2",
        "name": "GLM-5.2"
      },
      {
        "id": "glm-5.1",
        "name": "GLM-5.1"
      },
      {
        "id": "glm-5.0",
        "name": "GLM-5.0"
      },
      {
        "id": "glm-5.0-turbo",
        "name": "GLM-5.0-Turbo"
      },
      {
        "id": "glm-5v-turbo",
        "name": "GLM-5v-Turbo"
      },
      {
        "id": "glm-4.7",
        "name": "GLM-4.7"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax-M3"
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "kimi-k2.7",
        "name": "Kimi-K2.7-Code"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi-K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi-K2.5"
      },
      {
        "id": "hy3-preview",
        "name": "Hy3 Preview"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek-V4-Pro"
      },
      {
        "id": "deepseek-v4.1-flash",
        "name": "DeepSeek-V4.1-Flash"
      },
      {
        "id": "deepseek-v3-2-volc",
        "name": "DeepSeek-V3.2"
      }
    ]
  },
  {
    "id": "api-airforce",
    "alias": "af",
    "name": "API.airforce",
    "color": "#0EA5E9",
    "textIcon": "AF",
    "icon": "api-airforce",
    "website": "https://api.airforce",
    "notice": "",
    "apiKeyUrl": "https://api.airforce",
    "format": "openai",
    "baseUrl": "https://api.airforce/v1/chat/completions",
    "modelsFetcherUrl": "https://api.airforce/v1/models",
    "models": [
      {
        "id": "gpt-oss-120b",
        "name": "GPT-OSS 120B (Free)",
        "contextLength": 131072
      },
      {
        "id": "gpt-oss-20b",
        "name": "GPT-OSS 20B (Free)",
        "contextLength": 131072
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code (Free)",
        "contextLength": 262144
      }
    ]
  },
  {
    "id": "baidu",
    "alias": "qianfan",
    "name": "Baidu Qianfan",
    "color": "#2932E1",
    "textIcon": "BD",
    "icon": "baidu",
    "website": "https://cloud.baidu.com/product/qianfan.html",
    "notice": "",
    "apiKeyUrl": "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    "format": "openai",
    "baseUrl": "https://qianfan.baidubce.com/v2/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "contextLength": 1048576
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 1048576
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2",
        "contextLength": 512000
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1",
        "contextLength": 198000
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6",
        "contextLength": 262144
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen 3.5 397B A17B",
        "contextLength": 262144
      },
      {
        "id": "qwen3.5-27b",
        "name": "Qwen 3.5 27B",
        "contextLength": 262144
      }
    ]
  },
  {
    "id": "bazaarlink",
    "alias": "bzl",
    "name": "Bazaarlink",
    "color": "#DC2626",
    "textIcon": "BZ",
    "icon": "bazaarlink",
    "website": "https://bazaarlink.ai",
    "notice": "",
    "apiKeyUrl": "https://bazaarlink.ai",
    "format": "openai",
    "baseUrl": "https://bazaarlink.ai/api/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "auto:free",
        "name": "Auto Free (Zero Cost)"
      },
      {
        "id": "claude-opus-4.7",
        "name": "Claude Opus 4.7",
        "contextLength": 1000000
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6",
        "contextLength": 1000000
      },
      {
        "id": "claude-haiku-4.5",
        "name": "Claude Haiku 4.5",
        "contextLength": 200000
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini",
        "contextLength": 400000
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano",
        "contextLength": 400000
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3",
        "contextLength": 1000000
      },
      {
        "id": "grok-4.20",
        "name": "Grok 4.20",
        "contextLength": 2000000
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro",
        "contextLength": 1048576
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash",
        "contextLength": 1048576
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite",
        "contextLength": 1048576
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6",
        "contextLength": 262144
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5",
        "contextLength": 262144
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1",
        "contextLength": 204800
      },
      {
        "id": "glm-5",
        "name": "GLM 5",
        "contextLength": 204800
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro",
        "contextLength": 1050000
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5",
        "contextLength": 1050000
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3",
        "contextLength": 1048576
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7",
        "contextLength": 204800
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5",
        "contextLength": 204800
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus",
        "contextLength": 1000000
      },
      {
        "id": "nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super",
        "contextLength": 1000000
      }
    ]
  },
  {
    "id": "bluesminds",
    "alias": "bm",
    "name": "BluesMinds",
    "color": "#2563EB",
    "textIcon": "BM",
    "icon": "bluesminds",
    "website": "https://bluesminds.com",
    "notice": "",
    "apiKeyUrl": "https://bluesminds.com",
    "format": "openai",
    "baseUrl": "https://api.bluesminds.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "contextLength": 1048576
      },
      {
        "id": "gpt-4.1-mini",
        "name": "GPT-4.1 Mini",
        "contextLength": 1048576
      },
      {
        "id": "gpt-4.1-nano",
        "name": "GPT-4.1 Nano",
        "contextLength": 1048576
      },
      {
        "id": "claude-sonnet-4-5",
        "name": "Claude Sonnet 4.5",
        "contextLength": 200000
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5",
        "contextLength": 200000
      },
      {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash",
        "contextLength": 1048576
      },
      {
        "id": "gemini-2.0-flash-exp",
        "name": "Gemini 2.0 Flash (Exp)",
        "contextLength": 1048576
      },
      {
        "id": "qwen-turbo",
        "name": "Qwen Turbo",
        "contextLength": 1000000
      },
      {
        "id": "kimi-k2",
        "name": "Kimi K2",
        "contextLength": 262144
      },
      {
        "id": "kimi-k2-thinking",
        "name": "Kimi K2 Thinking",
        "contextLength": 262144
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7",
        "contextLength": 204800
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5",
        "contextLength": 204800
      },
      {
        "id": "claude-opus-4-5",
        "name": "Claude Opus 4.5 (VIP)",
        "contextLength": 200000
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro (VIP)",
        "contextLength": 1048576
      }
    ]
  },
  {
    "id": "kilo-gateway",
    "alias": "kgw",
    "name": "Kilo Gateway",
    "color": "#8B5CF6",
    "textIcon": "KG",
    "icon": "kilo-gateway",
    "website": "https://kilo.ai",
    "notice": "",
    "apiKeyUrl": "https://kilo.ai/dashboard?tab=apiKeys",
    "format": "openai",
    "baseUrl": "https://api.kilo.ai/api/gateway/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "kilo-auto/free",
        "name": "Kilo Auto Free",
        "contextLength": 256000
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b:free",
        "name": "Nemotron 3 Super 120B (Free)",
        "contextLength": 262144
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "name": "Nemotron 3 Ultra 550B (Free)",
        "contextLength": 1000000
      },
      {
        "id": "kwaipilot/kat-coder-pro-v2.5:free",
        "name": "Kat Coder Pro v2.5 (Free)",
        "contextLength": 256000
      },
      {
        "id": "kilo-auto/frontier",
        "name": "Kilo Auto Frontier",
        "contextLength": 1000000
      },
      {
        "id": "kilo-auto/balanced",
        "name": "Kilo Auto Balanced",
        "contextLength": 1000000
      }
    ]
  },
  {
    "id": "llm7",
    "alias": "llm7",
    "name": "LLM7",
    "color": "#7C3AED",
    "textIcon": "L7",
    "icon": "llm7",
    "website": "https://llm7.io",
    "notice": "",
    "apiKeyUrl": "https://llm7.io",
    "format": "openai",
    "baseUrl": "https://api.llm7.io/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5 (LLM7)",
        "contextLength": 1050000
      },
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5 (LLM7)",
        "contextLength": 1000000
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash (LLM7)",
        "contextLength": 1000000
      },
      {
        "id": "grok-4.5",
        "name": "Grok 4.5 (LLM7)",
        "contextLength": 500000
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3 (LLM7)",
        "contextLength": 1000000
      }
    ]
  },
  {
    "id": "sambanova",
    "alias": "samba",
    "name": "SambaNova",
    "color": "#F97316",
    "textIcon": "SN",
    "icon": "sambanova",
    "website": "https://sambanova.ai",
    "notice": "",
    "apiKeyUrl": "https://cloud.sambanova.ai/apis",
    "format": "openai",
    "baseUrl": "https://api.sambanova.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7",
        "contextLength": 196608
      }
    ]
  },
  {
    "id": "tencent",
    "alias": "hunyuan",
    "name": "Tencent Hunyuan",
    "color": "#0052D9",
    "textIcon": "HY",
    "icon": "tencent",
    "website": "https://cloud.tencent.com/product/hunyuan",
    "notice": "",
    "apiKeyUrl": "https://console.cloud.tencent.com/hunyuan/api-key",
    "format": "openai",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "hunyuan-turbos-latest",
        "name": "Hunyuan TurboS Latest",
        "contextLength": 200000
      },
      {
        "id": "hunyuan-t1-latest",
        "name": "Hunyuan T1 Latest",
        "contextLength": 256000
      }
    ]
  },
  {
    "id": "morph",
    "alias": "morph",
    "name": "Morph",
    "color": "#14B8A6",
    "textIcon": "MP",
    "icon": "morph",
    "website": "https://morphllm.com",
    "notice": "",
    "apiKeyUrl": "https://morphllm.com",
    "format": "openai",
    "baseUrl": "https://api.morphllm.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "morph-v3-large",
        "name": "Morph v3 Large"
      },
      {
        "id": "morph-v3-fast",
        "name": "Morph v3 Fast"
      },
      {
        "id": "morph-qwen35-397b",
        "name": "Qwen 3.5 397B (Morph)",
        "contextLength": 262144
      },
      {
        "id": "morph-minimax27-230b",
        "name": "MiniMax M2.7 (Morph)",
        "contextLength": 200704
      },
      {
        "id": "morph-qwen36-27b",
        "name": "Qwen 3.6 27B (Morph)",
        "contextLength": 262144
      },
      {
        "id": "morph-dsv4flash",
        "name": "DeepSeek V4 Flash (Morph)",
        "contextLength": 1048576
      }
    ]
  },
  {
    "id": "poolside",
    "alias": "poolside",
    "name": "Poolside",
    "color": "#0EA5E9",
    "textIcon": "PS",
    "icon": "poolside",
    "website": "https://poolside.ai",
    "notice": "",
    "apiKeyUrl": "https://platform.poolside.ai/api-keys",
    "format": "openai",
    "baseUrl": "https://inference.poolside.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "poolside/laguna-s-2.1",
        "name": "Laguna S 2.1"
      },
      {
        "id": "poolside/laguna-xs-2.1",
        "name": "Laguna XS 2.1"
      }
    ]
  },
  {
    "id": "tokenrouter",
    "alias": "tokenrouter",
    "name": "TokenRouter",
    "color": "#0EA5E9",
    "textIcon": "TR",
    "icon": "tokenrouter",
    "website": "https://www.tokenrouter.com",
    "notice": "OpenAI-compatible gateway. 300+ models (OpenAI, Claude, Gemini, Qwen, DeepSeek, Kimi, GLM, dsb).",
    "apiKeyUrl": "https://www.tokenrouter.com",
    "format": "openai",
    "baseUrl": "https://api.tokenrouter.com/v1/chat/completions",
    "modelsFetcherUrl": "https://api.tokenrouter.com/v1/models",
    "models": [
      {
        "id": "anthropic/claude-haiku-4.5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "anthropic/claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "anthropic/claude-opus-4.8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "anthropic/claude-opus-4.8-fast",
        "name": "Claude Opus 4.8 Fast"
      },
      {
        "id": "openai/gpt-5.4",
        "name": "Gpt 5.4"
      },
      {
        "id": "openai/gpt-5.4-mini",
        "name": "Gpt 5.4 Mini"
      },
      {
        "id": "openai/gpt-5.4-pro",
        "name": "Gpt 5.4 Pro"
      },
      {
        "id": "openai/gpt-5.5",
        "name": "Gpt 5.5"
      },
      {
        "id": "openai/gpt-5.6-sol",
        "name": "Gpt 5.6 Sol"
      },
      {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash"
      },
      {
        "id": "google/gemini-3.6-flash",
        "name": "Gemini 3.6 Flash"
      },
      {
        "id": "deepseek/deepseek-v4-flash",
        "name": "Deepseek V4 Flash"
      },
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "Deepseek V4 Pro"
      },
      {
        "id": "qwen/qwen3-coder-next",
        "name": "Qwen3 Coder Next"
      },
      {
        "id": "qwen/qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen/qwen3.8-max",
        "name": "Qwen3.8 Max"
      },
      {
        "id": "moonshotai/kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      },
      {
        "id": "moonshotai/kimi-k3-free",
        "name": "Kimi K3 Free"
      },
      {
        "id": "z-ai/glm-5.3-free",
        "name": "Glm 5.3 Free"
      },
      {
        "id": "z-ai/glm-5.2",
        "name": "Glm 5.2"
      },
      {
        "id": "z-ai/glm-5-turbo",
        "name": "Glm 5 Turbo"
      },
      {
        "id": "x-ai/grok-4.5",
        "name": "Grok 4.5"
      }
    ]
  },
  {
    "id": "alitp-intl",
    "alias": "alitp-intl",
    "name": "Alibaba Token Plan",
    "color": "#FF6A00",
    "textIcon": "ATP",
    "icon": "alitp-intl",
    "website": "https://www.alibabacloud.com/campaign/ai-landing-page-token",
    "notice": "",
    "apiKeyUrl": "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    "format": "openai",
    "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "qwen3.8-max-preview",
        "name": "Qwen3.8 Max Preview"
      },
      {
        "id": "qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.6-flash",
        "name": "Qwen3.6 Flash"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      }
    ]
  },
  {
    "id": "tokenharbor",
    "alias": "tokenharbor",
    "name": "Token Harbor",
    "color": "#0F766E",
    "textIcon": "TH",
    "icon": "tokenharbor",
    "website": "https://tokenharbor.ai",
    "notice": "OpenAI-compatible aggregator. One API key reaches every model, billed per-token from a prepaid wallet. Model ids are bare (e.g. claude-opus-5.5, gpt-6-astra, deepseek-v4.1-flash:free) and are fetched live from the provider.",
    "apiKeyUrl": "https://tokenharbor.ai/dashboard",
    "format": "openai",
    "baseUrl": "https://tokenharbor.ai/v1/chat/completions",
    "modelsFetcherUrl": "https://tokenharbor.ai/v1/models",
    "models": [
      {
        "id": "claude-opus-5.5",
        "name": "Claude Opus 5.5"
      },
      {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5"
      },
      {
        "id": "gpt-6-astra",
        "name": "GPT-6 Astra"
      },
      {
        "id": "gpt-6-sol",
        "name": "GPT-6 Sol"
      },
      {
        "id": "deepseek-v4.1-flash:free",
        "name": "DeepSeek V4.1 Flash (Free)"
      },
      {
        "id": "grok-4.7",
        "name": "Grok 4.7"
      }
    ]
  },
  {
    "id": "dahl",
    "alias": "dahl",
    "name": "Dahl Inference",
    "color": "#1E40AF",
    "textIcon": "DH",
    "icon": "dahl",
    "website": "https://dahl.global",
    "notice": "OpenAI-compatible Gonka inference node. Small, fixed catalogue (GLM-5.3-Flash, DeepSeek-V4-Flash, MiniMax-M2.7) at a flat per-token rate.",
    "apiKeyUrl": "https://dahl.global/dashboard",
    "format": "openai",
    "baseUrl": "https://inference.dahl.global/v1/chat/completions",
    "modelsFetcherUrl": "https://inference.dahl.global/v1/models",
    "models": [
      {
        "id": "zai-org/GLM-5.3-Flash",
        "name": "GLM-5.3 Flash"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash-0731",
        "name": "DeepSeek V4 Flash 0731"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.7",
        "name": "MiniMax M2.7"
      }
    ]
  },
  {
    "id": "atria",
    "alias": "atria",
    "name": "Atria Dawn",
    "color": "#C2410C",
    "textIcon": "AD",
    "icon": "atria",
    "website": "https://atria-asi.ai",
    "notice": "OpenAI-compatible endpoint from Atria Dawn (AtomInnoLab). Currently a research preview offering a single text model, Atria-Dawn-Preview.",
    "apiKeyUrl": "https://api.atria-asi.ai/dashboard",
    "format": "openai",
    "baseUrl": "https://api.atria-asi.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "Atria-Dawn-Preview",
        "name": "Atria Dawn Preview"
      }
    ]
  },
  {
    "id": "agnes",
    "alias": "agnes",
    "name": "Agnes AI",
    "color": "#7C3AED",
    "textIcon": "AG",
    "icon": "agnes",
    "website": "https://agnes-ai.com",
    "notice": "OpenAI-compatible gateway from Agnes AI, offering free API credits on sign-up. Accepts a bearer token or an x-api-key header.",
    "apiKeyUrl": "https://platform.agnes-ai.com",
    "format": "openai",
    "baseUrl": "https://apihub.agnes-ai.com/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "agnes-2.5-flash",
        "name": "Agnes 2.5 Flash"
      },
      {
        "id": "agnes-2.5-pro",
        "name": "Agnes 2.5 Pro"
      },
      {
        "id": "agnes-2.5-pro-beta",
        "name": "Agnes 2.5 Pro Beta"
      },
      {
        "id": "agnes-3.0-flash",
        "name": "Agnes 3.0 Flash"
      }
    ]
  },
  {
    "id": "bai",
    "alias": "bai",
    "name": "B.AI",
    "color": "#0369A1",
    "textIcon": "BA",
    "icon": "bai",
    "website": "https://b.ai",
    "notice": "OpenAI-compatible gateway with one of the larger catalogues here. Accepts a bearer token or an x-api-key header. Model ids are fetched live from the provider.",
    "apiKeyUrl": "https://b.ai",
    "format": "openai",
    "baseUrl": "https://api.b.ai/v1/chat/completions",
    "modelsFetcherUrl": "https://api.b.ai/v1/models",
    "models": []
  },
  {
    "id": "muse",
    "alias": "muse",
    "name": "Muse (Meta Model API)",
    "color": "#0866FF",
    "textIcon": "MU",
    "icon": "muse",
    "website": "https://muse.ai",
    "notice": "Sign in with your Meta account (Muse Code subscription) or paste a Model API key from dev.meta.ai. Subscription keys are minted per account; Meta may train on contributor-tier data.",
    "apiKeyUrl": "https://dev.meta.ai",
    "format": "openai",
    "baseUrl": "https://api.meta.ai/v1/chat/completions",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "muse-spark-1.3",
        "name": "Muse Spark 1.3"
      },
      {
        "id": "muse-spark-1.2",
        "name": "Muse Spark 1.2"
      },
      {
        "id": "muse-spark-1.1",
        "name": "Muse Spark 1.1"
      },
      {
        "id": "muse-spark-1.3-contributor",
        "name": "Muse Spark 1.3 Contributor"
      },
      {
        "id": "muse-spark-1.2-contributor",
        "name": "Muse Spark 1.2 Contributor"
      }
    ]
  },
  {
    "id": "bedrock",
    "alias": "br",
    "name": "AWS Bedrock",
    "color": "#FF9900",
    "textIcon": "BR",
    "icon": "bedrock",
    "website": "https://aws.amazon.com/bedrock/",
    "notice": "Two ways to authenticate, both entered in the AWS Bedrock Credentials section below. SSO / profile (recommended): fill in Profile and Region, leave the API key empty, then run `aws sso login --profile <name>` — credentials refresh automatically. Static keys: put the AWS secret access key in the API Key field and the key id in Access Key ID, adding Session Token if they are temporary (ASIA…) keys. A profile, if set, takes precedence over static keys.",
    "apiKeyUrl": "https://console.aws.amazon.com/iam/home#/security_credentials",
    "format": "claude",
    "baseUrl": "https://bedrock-runtime.{region}.amazonaws.com",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "us.anthropic.claude-opus-5",
        "name": "Claude Opus 5"
      },
      {
        "id": "us.anthropic.claude-sonnet-5",
        "name": "Claude Sonnet 5"
      },
      {
        "id": "us.anthropic.claude-fable-5",
        "name": "Claude Fable 5"
      },
      {
        "id": "us.anthropic.claude-opus-4-8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "us.anthropic.claude-opus-4-7",
        "name": "Claude Opus 4.7"
      },
      {
        "id": "us.anthropic.claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "us.anthropic.claude-opus-4-5-20251101-v1:0",
        "name": "Claude Opus 4.5"
      },
      {
        "id": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "name": "Claude Sonnet 4.5"
      },
      {
        "id": "us.anthropic.claude-opus-4-1-20250805-v1:0",
        "name": "Claude Opus 4.1"
      },
      {
        "id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "name": "Claude Sonnet 4"
      },
      {
        "id": "us.anthropic.claude-3-haiku-20240307-v1:0",
        "name": "Claude 3 Haiku"
      }
    ]
  },
  {
    "id": "bedrock-xai",
    "alias": "brx",
    "name": "AWS Bedrock (xAI)",
    "color": "#FF9900",
    "textIcon": "BX",
    "icon": "bedrock-xai",
    "website": "https://aws.amazon.com/bedrock/",
    "notice": "xAI Grok models hosted on AWS Bedrock. Authenticate exactly like the AWS Bedrock provider: fill in Profile and Region and leave the API key empty, then run `aws sso login --profile <name>`; or use static keys with the AWS secret access key as the API key. Note Grok is a reasoning model and spends output budget thinking before it answers — a small max_tokens returns finish_reason \"length\" with empty content, so allow a few thousand tokens.",
    "apiKeyUrl": "https://console.aws.amazon.com/iam/home#/security_credentials",
    "format": "openai",
    "baseUrl": "https://bedrock-runtime.{region}.amazonaws.com",
    "modelsFetcherUrl": "",
    "models": [
      {
        "id": "us.xai.grok-4.6",
        "name": "Grok 4.6"
      },
      {
        "id": "global.xai.grok-4.6",
        "name": "Grok 4.6 (global)"
      }
    ]
  },
  {
    "id": "nous",
    "alias": "nous",
    "name": "Nous Research",
    "color": "#7C3AED",
    "textIcon": "NR",
    "icon": "nous",
    "website": "https://nousresearch.com",
    "notice": "Connect with OAuth Device Code (free account, no payment required) or a Nous Portal API key.",
    "apiKeyUrl": "https://portal.nousresearch.com/api-keys",
    "format": "openai",
    "baseUrl": "https://inference-api.nousresearch.com/v1/chat/completions",
    "modelsFetcherUrl": "https://inference-api.nousresearch.com/v1/models",
    "models": [
      {
        "id": "meituan/longcat-2.0:free",
        "name": "Meituan: LongCat 2.0",
        "contextLength": 1048756,
        "maxOutputTokens": 262144
      },
      {
        "id": "meituan/longcat-2.5-preview:free",
        "name": "Meituan: LongCat 2.5 Preview",
        "contextLength": 1048576,
        "maxOutputTokens": 131072
      },
      {
        "id": "stepfun/step-5-preview:free",
        "name": "StepFun: Step 5 Preview",
        "contextLength": 1000000,
        "maxOutputTokens": 64000
      },
      {
        "id": "upstage/solar-mini4:free",
        "name": "Upstage: Solar Mini 4",
        "contextLength": 524288,
        "maxOutputTokens": 131072
      },
      {
        "id": "stepfun/step-3.7-flash:free",
        "name": "StepFun: Step 3.7 Flash",
        "contextLength": 262144,
        "maxOutputTokens": 256000
      },
      {
        "id": "poolside/laguna-s-2.1:free",
        "name": "Poolside: Laguna S 2.1",
        "contextLength": 262144,
        "maxOutputTokens": 131072
      },
      {
        "id": "poolside/laguna-xs-2.1:free",
        "name": "Poolside: Laguna XS 2.1",
        "contextLength": 262144,
        "maxOutputTokens": 32768
      },
      {
        "id": "stealth/missingno",
        "name": "MissingNo",
        "contextLength": 262144,
        "maxOutputTokens": 131072
      }
    ]
  }
];

export const PROVIDERS_BY_ID = new Map<string, ProviderCatalogItem>(
  PROVIDERS_CATALOG.map((p) => [p.id, p]),
);

export function getProviderMeta(providerId: string): ProviderCatalogItem | undefined {
  return PROVIDERS_BY_ID.get(providerId);
}
