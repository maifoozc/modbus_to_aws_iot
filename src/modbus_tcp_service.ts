// src/modbus_tcp_service.ts
import * as Modbus from "jsmodbus";
import { Socket } from "net";
import { DeviceConfig, ModbusRegister } from "./types/modbus";

type ModbusTCPClient = InstanceType<typeof Modbus.client.TCP>;

interface ModbusConnection {
  client: ModbusTCPClient;
  socket: Socket;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: () => boolean;
  readRegister: (register: ModbusRegister) => Promise<number>;
}

export const createModbusConnection = (
  config: DeviceConfig
): ModbusConnection => {
  const socket = new Socket();
  const client = new Modbus.client.TCP(socket, config.unit_id);

  socket.setTimeout(5000);
  socket.setKeepAlive(true, 60000);

  const connect = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket.connect(config.port, config.ip, () => {
        console.log(`Connected to ${config.name} at ${config.ip}:${config.port}`);
        resolve();
      });

      socket.once("error", reject);
      socket.once("timeout", () => reject(new Error('Connection timeout')));
    });
  };

  const readRegister = async (register: ModbusRegister): Promise<number> => {
    try {
      const address = register.address - 1; // Convert to 0-based
      const response = register.type === 'holding' 
        ? await client.readHoldingRegisters(address, register.data_type === 'float' ? 2 : 1)
        : await client.readInputRegisters(address, register.data_type === 'float' ? 2 : 1);
      
      // Process value based on data type
      if (register.data_type === 'float') {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt16BE(response.response.body.values[0], 0);
        buffer.writeUInt16BE(response.response.body.values[1], 2);
        return buffer.readFloatBE(0) * register.multiplier;
      }
      return response.response.body.values[0] * register.multiplier;
    } catch (error) {
      console.error(`Failed to read register ${register.desc}:`, error);
      throw error;
    }
  };

  const disconnect = (): void => {
    if (!socket.destroyed) {
      socket.end();
      console.log(`Disconnected from ${config.name}`);
    }
  };

  const isConnected = (): boolean => {
    return socket.readyState === 'open';
  };

  return {
    client,
    socket,
    connect,
    disconnect,
    isConnected,
    readRegister
  };
};