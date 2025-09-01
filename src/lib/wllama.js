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
  // Check if wllamaInstance is valid
  if (!wllamaInstance) {
    console.warn("formatChat called with null/undefined wllamaInstance, using fallback");
    const template = new Template(CHAT_TEMPLATE);
    return template.render({
      messages,
      bos_token: "",
      eos_token: "",
      add_generation_prompt: true,
    });
  }

  // Check if required methods exist
  if (typeof wllamaInstance.getChatTemplate !== "function") {
    console.warn("formatChat: getChatTemplate method not found, using fallback");
    const template = new Template(CHAT_TEMPLATE);
    return template.render({
      messages,
      bos_token: "",
      eos_token: "",
      add_generation_prompt: true,
    });
  }

  try {
    const chatTemplate = wllamaInstance.getChatTemplate();
    const template = new Template(chatTemplate ?? CHAT_TEMPLATE);

    let bosToken = "";
    let eosToken = "";

    // Safely get BOS/EOS tokens
    try {
      if (typeof wllamaInstance.getBOS === "function" && typeof wllamaInstance.detokenize === "function") {
        bosToken = await wllamaInstance.detokenize([wllamaInstance.getBOS()]);
      }
    } catch (e) {
      console.warn("Failed to get BOS token:", e.message);
    }

    try {
      if (typeof wllamaInstance.getEOS === "function" && typeof wllamaInstance.detokenize === "function") {
        eosToken = await wllamaInstance.detokenize([wllamaInstance.getEOS()]);
      }
    } catch (e) {
      console.warn("Failed to get EOS token:", e.message);
    }

    return template.render({
      messages,
      bos_token: bosToken,
      eos_token: eosToken,
      add_generation_prompt: true,
    });
  } catch (error) {
    console.error("formatChat error:", error);
    // Fallback: use default template if instance methods fail
    console.log("Using fallback template rendering due to error");
    const template = new Template(CHAT_TEMPLATE);
    return template.render({
      messages,
      bos_token: "",
      eos_token: "",
      add_generation_prompt: true,
    });
  }
};

let wllamaInstance = null;

// Wrapper class to handle shared Wllama state
class WllamaWrapper {
  constructor(wllama) {
    this.wllama = wllama;
    this.isModelLoaded = false;
    this.currentModelUrl = null;
    this.loadPromise = null;
  }

  async loadModel(files, options) {
    // If already loading, wait for it
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // If same model is already loaded, skip
    if (this.isModelLoaded && this.currentModelUrl === "local") {
      console.log("Model already loaded, skipping...");
      return;
    }

    this.loadPromise = (async () => {
      try {
        if (this.isModelLoaded) {
          await this.wllama.exit();
          this.isModelLoaded = false;
        }
        await this.wllama.loadModel(files, options);
        this.isModelLoaded = true;
        this.currentModelUrl = "local";
      } catch (error) {
        if (error.message.includes("already initialized") || error.message.includes("Module is already initialized")) {
          console.log("Module already initialized, assuming model is loaded");
          this.isModelLoaded = true;
          this.currentModelUrl = "local";
          return; // Return early to avoid throwing
        } else {
          throw error;
        }
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  async loadModelFromUrl(url, options) {
    // If already loading, wait for it
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // If same model is already loaded, skip
    if (this.isModelLoaded && this.currentModelUrl === url) {
      console.log("Model already loaded, skipping...");
      return;
    }

    this.loadPromise = (async () => {
      try {
        if (this.isModelLoaded) {
          await this.wllama.exit();
          this.isModelLoaded = false;
        }
        await this.wllama.loadModelFromUrl(url, options);
        this.isModelLoaded = true;
        this.currentModelUrl = url;
      } catch (error) {
        if (error.message.includes("already initialized") || error.message.includes("Module is already initialized")) {
          console.log("Module already initialized, assuming model is loaded");
          this.isModelLoaded = true;
          this.currentModelUrl = url;
          return; // Return early to avoid throwing
        } else {
          throw error;
        }
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  async exit() {
    if (this.loadPromise) {
      await this.loadPromise;
    }

    if (this.isModelLoaded) {
      try {
        await this.wllama.exit();
      } catch (error) {
        console.warn("Error during exit, ignoring:", error.message);
      }
      this.isModelLoaded = false;
      this.currentModelUrl = null;
    }
  }

  // Proxy all other methods to the underlying wllama instance
  createCompletion(...args) {
    return this.wllama.createCompletion(...args);
  }

  createChatCompletion(...args) {
    return this.wllama.createChatCompletion(...args);
  }

  getChatTemplate() {
    return this.wllama.getChatTemplate();
  }

  detokenize(...args) {
    return this.wllama.detokenize(...args);
  }

  getBOS() {
    return this.wllama.getBOS();
  }

  getEOS() {
    return this.wllama.getEOS();
  }
}

export const getWllamaInstance = () => {
  if (!wllamaInstance) {
    let rawWllama;

    try {
      rawWllama = new Wllama(
        {
          "single-thread/wllama.wasm": wllamaSingle,
          "multi-thread/wllama.wasm": wllamaMulti,
        },
        { suppressNativeLog: true }
      );
    } catch (error) {
      // If module is already initialized, try to find the existing instance
      if (error.message.includes("already initialized")) {
        console.log("WebAssembly module already initialized, attempting to reuse existing instance");

        // Try to find existing Wllama instance from global scope or parent window
        let existingWllama = null;

        // Check if there's already a global instance
        if (window.wllamaGlobalInstance && window.wllamaGlobalInstance.wllama) {
          existingWllama = window.wllamaGlobalInstance.wllama;
        }

        // Check parent window if we're in iframe (same-origin only)
        if (!existingWllama && window.parent !== window) {
          try {
            if (window.parent.wllamaGlobalInstance && window.parent.wllamaGlobalInstance.wllama) {
              existingWllama = window.parent.wllamaGlobalInstance.wllama;
            }
          } catch (e) {
            // Cross-origin access blocked, ignore
          }
        }

        if (existingWllama) {
          console.log("Found existing Wllama instance, sharing it");
          rawWllama = existingWllama;
        } else {
          // Fallback: create a mock object that matches Wllama's interface
          console.log("No existing instance found, creating mock for compatibility");
          rawWllama = {
            loadModel: async () => {
              throw new Error("Module is already initialized");
            },
            loadModelFromUrl: async () => {
              throw new Error("Module is already initialized");
            },
            exit: async () => {},
            createCompletion: async () => {
              throw new Error("WebAssembly module conflict - chat not available in iframe context");
            },
            createChatCompletion: async () => {
              throw new Error("WebAssembly module conflict - chat not available in iframe context");
            },
            // Add methods needed by formatChat
            getChatTemplate: () => CHAT_TEMPLATE,
            detokenize: async () => "",
            getBOS: () => 1, // Common BOS token ID
            getEOS: () => 2, // Common EOS token ID
          };
        }
      } else {
        throw error;
      }
    }

    wllamaInstance = new WllamaWrapper(rawWllama);

    // Store globally for iframe access
    if (!window.wllamaGlobalInstance) {
      window.wllamaGlobalInstance = wllamaInstance;
    }
  }

  return wllamaInstance;
};
