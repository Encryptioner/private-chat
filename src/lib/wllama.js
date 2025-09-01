import { Wllama } from "@wllama/wllama/esm";
import { Template } from "@huggingface/jinja";

import wllamaSingle from "@wllama/wllama/esm/single-thread/wllama.wasm?url";
import wllamaMulti from "@wllama/wllama/esm/multi-thread/wllama.wasm?url";

const CHAT_TEMPLATE =
  "{% for message in messages %}{{'<|im_start|>' + message['role'] + '\n' + message['content'] + '<|im_end|>' + '\n'}}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant\n' }}{% endif %}";

export const CHAT_ROLE = Object.freeze({
  system: "system",
  assistant: "assistant",
  user: "user",
});

const isLocalHost = ["localhost", "0.0.0.0", "127.0.0.1"].includes(window.location.hostname);

const models = {
  "Gemma 3 (1B)": {
    url: "https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
    license: "https://deepmind.google/models/gemma/gemma-3",
    description: "Gemma is a lightweight, family of models from Google built on Gemini technology.",
  },
  "Llama 3.2 (1B)": {
    url: "https://huggingface.co/unsloth/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    license: "https://raw.githubusercontent.com/meta-llama/llama-models/refs/heads/main/models/llama3_2/LICENSE",
    description: "Meta's Llama 3.2 goes small with this 1B model",
  },
  "LFM2 (700M)": {
    url: isLocalHost
      ? `${window.location.origin}/models/LFM2-700M-Q4_K_M.gguf`
      : "https://huggingface.co/unsloth/LFM2-700M-GGUF/resolve/main/LFM2-700M-Q4_K_M.gguf",
    license: "https://www.liquid.ai/lfm-license",
    description: "LFM2 models by Liquid AI are designed for on-device efficiency",
  },
  "Qwen 3 (0.6B)": {
    url: "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
    license: "https://qwenlm.github.io/",
    description: "Qwen3 is the latest generation of large language models in Qwen series",
  },
  "SmolLM2 (360M)": {
    url: "https://huggingface.co/unsloth/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf",
    license: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M#license",
    description: "SmolLM2 is a family of compact language models by Hugging Face",
  },
  "Gemma 3 (270M)": {
    url: "https://huggingface.co/unsloth/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf",
    license: "https://deepmind.google/models/gemma/gemma-3",
    description: "Gemma is a lightweight, family of models from Google built on Gemini technology.",
    default: true,
  },
};

export const PRESET_MODELS = Object.fromEntries(
  Object.entries(models).map(([name, rest]) => [
    name,
    {
      name,
      ...rest,
    },
  ])
);

export const formatChat = async (wllamaInstance, messages) => {
  const template = new Template(wllamaInstance.getChatTemplate() ?? CHAT_TEMPLATE);
  return template.render({
    messages,
    bos_token: await wllamaInstance.detokenize([wllamaInstance.getBOS()]),
    eos_token: await wllamaInstance.detokenize([wllamaInstance.getEOS()]),
    add_generation_prompt: true,
  });
};

export const getWllamaInstance = () =>
  new Wllama(
    {
      "single-thread/wllama.wasm": wllamaSingle,
      "multi-thread/wllama.wasm": wllamaMulti,
    },
    { suppressNativeLog: true }
  );
