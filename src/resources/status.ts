import type { Http } from "../http.ts";

// Esta rota só existe na prosa da documentação, sem fragmento OpenAPI, então o corpo fica sem tipo.
const PATH = "/v1/token_auth_status";

/** Confere se o par de tokens é aceito. Tokens recusados viram MercosError com kind "auth". */
export async function tokenStatus(http: Http, signal?: AbortSignal): Promise<unknown> {
  const response = await http.request<unknown>("GET", PATH, { signal });
  return response.data;
}
