/// <reference types="vite/client" />

import type { DeliveryCounterApi } from '../shared/types';

declare global {
  interface Window {
    deliveryCounter?: DeliveryCounterApi;
  }
}
