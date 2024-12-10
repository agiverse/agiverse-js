import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { DEFAULT_WS_ENDPOINT } from '../common/const';
import { ActionContext } from './context';

interface ActionHandler {
  func: Function;
  payloadDescription: string;
  paymentDescription: string;
}

export class SmartBuilding extends EventEmitter {
  public apiKey: string;
  public buildingId: number;
  public players: any[];
  public buildingInfo: any;
  public wsEndpoint: string;
  private ws: WebSocket | null;
  private reconnectInterval: number;
  private actionHandlers: { [key: string]: ActionHandler };

  constructor(options: {
    apiKey: string;
    buildingId: number;
    wsEndpoint?: string;
    reconnectInterval?: number;
  }) {
    super();
    this.apiKey = options.apiKey;
    this.buildingId = options.buildingId;
    this.wsEndpoint = options.wsEndpoint || DEFAULT_WS_ENDPOINT;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.players = [];
    this.buildingInfo = {};
    this.ws = null;
    this.actionHandlers = {};
  }

  /**
   * Register an action handler.
   *
   * @param config - Configuration for the action.
   * @param handler - The handler function.
   */
  public action(
    config: {
      action: string;
      payloadDescription?: string;
      paymentDescription?: string;
    },
    handler: Function
  ): void {
    this.actionHandlers[config.action] = {
      func: handler,
      payloadDescription: config.payloadDescription || '',
      paymentDescription: config.paymentDescription || '',
    };
  }

  /**
   * Start the smart building client.
   */
  public run(): void {
    this.connect();
  }

  private connect(): void {
    const wsUri = `${this.wsEndpoint}?type=building&api-key=${this.apiKey}&building-id=${this.buildingId}`;
    this.ws = new WebSocket(wsUri);

    this.ws.on('open', () => {
      console.log('WebSocket connection established.');

      const registerActionsMessage = {
        type: 'registerActions',
        data: {
          actions: Object.keys(this.actionHandlers).reduce(
            (acc: any, actionName: string) => {
              const handler = this.actionHandlers[actionName];
              acc[actionName] = {
                payload: handler.payloadDescription,
                payment: handler.paymentDescription,
              };
              return acc;
            },
            {}
          ),
        },
      };

      this.ws?.send(JSON.stringify(registerActionsMessage));

      this.emit('ready');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', () => {
      console.warn('Connection closed, attempting to reconnect...');
      setTimeout(() => this.connect(), this.reconnectInterval);
    });

    this.ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      this.ws?.close();
    });
  }

  private handleMessage(message: string): void {
    try {
      const msg = JSON.parse(message);
      const msgType = msg.type;

      if (msgType === 'building') {
        this.buildingInfo = msg.data;
        this.emit('buildingInfo', this.buildingInfo);
      } else if (msgType === 'players') {
        this.players = msg.data;
        this.emit('players', this.players);
      } else if (msgType === 'action') {
        const actionName = msg.data.action;
        const handler = this.actionHandlers[actionName];

        if (handler) {
          const ctx = new ActionContext(
            msg.data.playerID,
            msg.data.playerName,
            this,
            this.ws!,
            msg.data.actionID,
            actionName
          );
          const payload = msg.data.payload;
          const payment = msg.data.payment;

          if (handler.func.length === 2) {
            handler.func(ctx, payload);
          } else if (handler.func.length === 3) {
            handler.func(ctx, payload, payment);
          } else {
            console.warn(
              `Handler for action '${actionName}' has an unexpected number of parameters`
            );
          }
        } else {
          console.warn(`No handler for action '${actionName}'`);
        }
      }
    } catch (error) {
      console.error('Failed to handle message:', error);
    }
  }
}
