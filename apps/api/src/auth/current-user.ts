import { createParamDecorator } from '@nestjs/common';

export const DEV_USER_ID = 'b5b48f38-1fb2-4a65-965d-f15253ec8b26';
export interface User {
  id: string;
}
export const CurrentUser = createParamDecorator((): User => ({
  id: DEV_USER_ID,
}));
