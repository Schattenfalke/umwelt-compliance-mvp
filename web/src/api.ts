import {
  AdminMetrics,
  AdminUser,
  NotificationEvent,
  Project,
  PushSubscription,
  QaQueueEntry,
  TaxonomyTerm,
  Ticket,
  TicketStatus,
  TicketDetail,
  TicketTemplate
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

type RequestInitExt = RequestInit & {
  token?: string;
};

async function request<T>(path: string, init: RequestInitExt = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf") || contentType.includes("text/csv")) {
    return (await response.blob()) as T;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export async function login(email: string, password: string): Promise<{ access_token: string }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function listTickets(token: string, params?: Record<string, string | number>): Promise<Ticket[]> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : "";
  return request(`/tickets${query}`, { token });
}

export async function createTicket(token: string, payload: Record<string, unknown>): Promise<Ticket> {
  return request("/tickets", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function createHintTicket(
  token: string,
  payload: {
    project_id: string;
    title: string;
    description: string;
    category: string;
    location_lat: string;
    location_lng: string;
    geofence_radius_m: string;
    observed_at?: string;
    deadline_at?: string;
    taxonomy_term_ids: string[];
    files: File[];
  }
): Promise<Ticket> {
  const formData = new FormData();
  formData.append("project_id", payload.project_id);
  formData.append("title", payload.title);
  formData.append("description", payload.description);
  formData.append("category", payload.category);
  formData.append("location_lat", payload.location_lat);
  formData.append("location_lng", payload.location_lng);
  formData.append("geofence_radius_m", payload.geofence_radius_m);
  if (payload.observed_at) {
    formData.append("observed_at", payload.observed_at);
  }
  if (payload.deadline_at) {
    formData.append("deadline_at", payload.deadline_at);
  }
  formData.append("taxonomy_term_ids_json", JSON.stringify(payload.taxonomy_term_ids));

  for (const file of payload.files) {
    formData.append("files", file);
  }

  return request("/tickets/hints", {
    method: "POST",
    token,
    body: formData
  });
}

export async function getTicketDetail(token: string, ticketId: string): Promise<TicketDetail> {
  return request(`/tickets/${ticketId}`, { token });
}

export async function qualifyTicket(
  token: string,
  ticketId: string,
  payload: { task_class?: number; proof_policy_json?: Record<string, unknown> }
): Promise<Ticket> {
  return request(`/tickets/${ticketId}/qualify`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function publishTicket(token: string, ticketId: string): Promise<Ticket> {
  return request(`/tickets/${ticketId}/publish`, {
    method: "POST",
    token
  });
}

export async function acceptTicket(token: string, ticketId: string): Promise<Ticket> {
  return request(`/tickets/${ticketId}/accept`, {
    method: "POST",
    token
  });
}

export async function moveTicketStatus(
  token: string,
  ticketId: string,
  toStatus: TicketStatus
): Promise<Ticket> {
  return request(`/tickets/${ticketId}/move`, {
    method: "POST",
    token,
    body: JSON.stringify({ to_status: toStatus })
  });
}

export async function submitProof(
  token: string,
  ticketId: string,
  payload: {
    notes: string;
    checklist_answers_json: string;
    gps_lat: string;
    gps_lng: string;
    captured_at: string;
    files: File[];
  }
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append("notes", payload.notes);
  formData.append("checklist_answers_json", payload.checklist_answers_json);
  if (payload.gps_lat) {
    formData.append("gps_lat", payload.gps_lat);
  }
  if (payload.gps_lng) {
    formData.append("gps_lng", payload.gps_lng);
  }
  if (payload.captured_at) {
    formData.append("captured_at", payload.captured_at);
  }
  for (const file of payload.files) {
    formData.append("files", file);
  }

  return request(`/tickets/${ticketId}/proofs`, {
    method: "POST",
    token,
    body: formData
  });
}

export async function qaDecision(
  token: string,
  proofId: string,
  payload: { decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "ESCALATE"; comment: string }
): Promise<Record<string, unknown>> {
  return request(`/proofs/${proofId}/qa`, {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function downloadProofFile(token: string, proofId: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/proofs/${proofId}/files/${fileId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }

  return response.blob();
}

export async function downloadReport(token: string, ticketId: string): Promise<Blob> {
  return request(`/tickets/${ticketId}/report.pdf`, { token });
}

export async function downloadProjectReport(token: string, projectId: string): Promise<Blob> {
  return request(`/reports/project.pdf?${new URLSearchParams({ project_id: projectId }).toString()}`, { token });
}

export async function downloadKa5Csv(
  token: string,
  params?: { project_id?: string; date_from?: string; date_to?: string }
): Promise<Blob> {
  const query = new URLSearchParams();
  if (params?.project_id) {
    query.set("project_id", params.project_id);
  }
  if (params?.date_from) {
    query.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    query.set("date_to", params.date_to);
  }
  return request(`/exports/ka5.csv${query.toString() ? `?${query.toString()}` : ""}`, { token });
}

export async function downloadKa5Json(
  token: string,
  params?: { project_id?: string; date_from?: string; date_to?: string }
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams();
  if (params?.project_id) {
    query.set("project_id", params.project_id);
  }
  if (params?.date_from) {
    query.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    query.set("date_to", params.date_to);
  }
  return request(`/exports/ka5.json${query.toString() ? `?${query.toString()}` : ""}`, { token });
}

export async function listProjects(token: string): Promise<Project[]> {
  return request("/projects", { token });
}

export async function createProject(
  token: string,
  payload: { name: string; description: string }
): Promise<Project> {
  return request("/projects", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function listQaQueue(token: string, flag: "all" | "geo_fail" | "time_fail" | "exif_missing"): Promise<QaQueueEntry[]> {
  return request(`/qa/queue?${new URLSearchParams({ flag }).toString()}`, { token });
}

export async function listUsers(token: string): Promise<AdminUser[]> {
  return request("/admin/users", { token });
}

export async function createAdminUser(
  token: string,
  payload: { email: string; display_name?: string; role: string; is_verified?: boolean }
): Promise<AdminUser> {
  return request("/admin/users", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateUserRole(token: string, userId: string, role: string): Promise<AdminUser> {
  return request(`/admin/users/${userId}/role`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ role })
  });
}

export async function listTemplates(token: string): Promise<TicketTemplate[]> {
  return request("/templates", { token });
}

export async function listTaxonomyTerms(
  token: string,
  params?: { domain?: string; q?: string; include_inactive?: boolean }
): Promise<TaxonomyTerm[]> {
  const query = new URLSearchParams();
  if (params?.domain) {
    query.set("domain", params.domain);
  }
  if (params?.q) {
    query.set("q", params.q);
  }
  if (params?.include_inactive) {
    query.set("include_inactive", "true");
  }
  return request(`/taxonomy/terms${query.toString() ? `?${query.toString()}` : ""}`, { token });
}

export async function createTemplate(
  token: string,
  payload: {
    name: string;
    category: string;
    task_class: number;
    checklist_json: Record<string, unknown>;
    proof_policy_json: Record<string, unknown>;
    default_geofence_radius_m: number;
  }
): Promise<TicketTemplate> {
  return request("/templates", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateTemplate(
  token: string,
  templateId: string,
  payload: Partial<{
    name: string;
    category: string;
    task_class: number;
    checklist_json: Record<string, unknown>;
    proof_policy_json: Record<string, unknown>;
    default_geofence_radius_m: number;
  }>
): Promise<TicketTemplate> {
  return request(`/templates/${templateId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload)
  });
}

export async function deleteTemplate(token: string, templateId: string): Promise<void> {
  await request(`/templates/${templateId}`, {
    method: "DELETE",
    token
  });
}

export async function getAdminMetrics(token: string): Promise<AdminMetrics> {
  return request("/admin/metrics", { token });
}

export async function savePushSubscription(
  token: string,
  payload: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }
): Promise<PushSubscription> {
  return request("/push/subscriptions", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function listPushSubscriptions(token: string): Promise<PushSubscription[]> {
  return request("/push/subscriptions", { token });
}

export async function deletePushSubscription(token: string, subscriptionId: string): Promise<void> {
  return request(`/push/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    token
  });
}

export async function listNotifications(
  token: string,
  params?: { unread_only?: boolean; limit?: number }
): Promise<NotificationEvent[]> {
  const query = new URLSearchParams();
  if (params?.unread_only !== undefined) {
    query.set("unread_only", String(params.unread_only));
  }
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  return request(`/notifications${query.toString() ? `?${query.toString()}` : ""}`, { token });
}

export async function markNotificationRead(token: string, notificationId: string): Promise<NotificationEvent> {
  return request(`/notifications/${notificationId}/read`, {
    method: "POST",
    token
  });
}

export function decodeJwt(token: string): { id: string; email: string; role: string } {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}
