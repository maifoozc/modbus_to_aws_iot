// src/types/modbus.ts
export type ModbusDataType = "int16" | "float";
export type RegisterType = "holding" | "input";

export interface ModbusRegister {
  address: number;
  desc: string;
  type: RegisterType; // Changed to use the type alias
  data_type: ModbusDataType;
  multiplier: number;
}

export interface DeviceConfig {
  name: string;
  ip: string;
  port: number;
  unit_id: number;
  registers: ModbusRegister[];
}

export interface AppConfig {
  site_id: number;
  poll_interval?: number;
  components: {
    [key: string]: DeviceConfig;
  };
}
