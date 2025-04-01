// src/config-validator.ts
import { AppConfig } from "./types/modbus";

export function assertConfig(config: any): asserts config is AppConfig {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid config format");
  }
  // Add more validation as needed
}