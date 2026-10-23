export interface CreateOrderRequest {
  restaurantId: string;
  total: number;
  notes?: string;
  externalId: string | null;
}
