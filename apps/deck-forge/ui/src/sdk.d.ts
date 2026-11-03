declare module '@kirocrew/app-sdk' {
  export function useAppApi(): { get(p: string): Promise<any>; post(p: string, body?: any): Promise<any> }
  export function useNotify(): any
}
declare module '@kirocrew/app-sdk/ui' {
  export const Card: any, CardTitle: any, PageHeader: any, Btn: any, Badge: any, EmptyState: any
}
