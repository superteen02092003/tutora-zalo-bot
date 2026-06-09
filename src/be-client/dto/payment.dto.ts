export interface PaymentQrDto {
  qrCodeUrl: string;
  orderCode: number;
  amount: number;
  expiredAt: string;
}
