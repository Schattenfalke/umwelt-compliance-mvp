import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptTicket,
  createProject,
  createHintTicket,
  createTemplate,
  createTicket,
  downloadKa5Csv,
  downloadKa5Json,
  deleteTemplate,
  decodeJwt,
  downloadProofFile,
  downloadProjectReport,
  downloadReport,
  getAdminMetrics,
  getTicketDetail,
  listNotifications,
  listProjects,
  listQaQueue,
  listTaxonomyTerms,
  listTickets,
  listTemplates,
  listUsers,
  login,
  markNotificationRead,
  moveTicketStatus,
  publishTicket,
  qaDecision,
  qualifyTicket,
  savePushSubscription,
  submitProof,
  updateTemplate,
  updateUserRole
} from "./api";
import {
  AdminMetrics,
  AdminUser,
  NotificationEvent,
  Project,
  QaQueueEntry,
  Role,
  TaxonomyTerm,
  Ticket,
  TicketDetail,
  TicketStatus,
  TicketTemplate
} from "./types";

type View = "tickets" | "kanban" | "feed" | "qa" | "admin" | "help";

const kanbanColumns: TicketStatus[] = [
  "NEW",
  "QUALIFIED",
  "PUBLISHED",
  "ACCEPTED",
  "PROOF_SUBMITTED",
  "NEEDS_CHANGES",
  "COMPLETED",
  "REJECTED",
  "ARCHIVED"
];

const categoryPills = [
  "Vegetation",
  "Boden",
  "Abfall",
  "Erosion",
  "Wasser",
  "Sicherheit",
  "Bohrstock",
  "Luzerne",
  "Schadstelle",
  "Monitoring"
];

const roleEmails: Record<Role, string> = {
  ADMIN: "admin@example.com",
  REQUESTER: "requester@example.com",
  WORKER: "worker@example.com",
  QA: "qa@example.com"
};

const defaultCreateTicket = {
  title: "",
  description: "",
  category: "",
  task_class: 1,
  location_lat: "52.52",
  location_lng: "13.405",
  geofence_radius_m: "25",
  time_window_start_date: "",
  time_window_start_time: "",
  time_window_end_date: "",
  time_window_end_time: "",
  deadline_date: "",
  deadline_time: "",
  taxonomy_term_ids: [] as string[],
  proof_policy_json: '{"min_photos":1,"require_gps":true,"required_fields":["checklist_complete"]}',
  safety_flags_json: '{"public_access_only":true,"permit_required":false,"no_trespass":true}'
};

const defaultProof = {
  notes: "",
  checklist_answers_json: '{"checklist_complete":true}',
  gps_lat: "",
  gps_lng: "",
  captured_date: "",
  captured_time: "",
  files: [] as File[]
};

const defaultHintForm = {
  title: "",
  description: "",
  category: "",
  location_lat: "52.52",
  location_lng: "13.405",
  geofence_radius_m: "25",
  observed_date: "",
  observed_time: "",
  deadline_date: "",
  deadline_time: "",
  taxonomy_term_ids: [] as string[],
  files: [] as File[]
};

const defaultTemplateForm = {
  name: "",
  category: "",
  task_class: 1,
  checklist_json: '{"fields":[]}',
  proof_policy_json: '{"min_photos":1,"require_gps":true}',
  default_geofence_radius_m: "25"
};

const defaultProjectForm = {
  name: "",
  description: ""
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatSeconds(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return `${Math.round(value)} s`;
}

function formatPercent(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return `${(value * 100).toFixed(1)} %`;
}

function toIsoFromDateAndTime(dateValue: string, timeValue: string, fieldName: string): string {
  if (!dateValue || !timeValue) {
    throw new Error(`${fieldName} ist unvollstaendig. Bitte Datum und Uhrzeit auswaehlen.`);
  }
  const parsed = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} ist ungueltig.`);
  }
  return parsed.toISOString();
}

function toOptionalIsoFromDateAndTime(dateValue: string, timeValue: string): string | null {
  if (!dateValue && !timeValue) {
    return null;
  }
  return toIsoFromDateAndTime(dateValue, timeValue, "Datum/Uhrzeit");
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "NEW":
      return "status-badge status-new";
    case "QUALIFIED":
      return "status-badge status-qualified";
    case "PUBLISHED":
      return "status-badge status-published";
    case "ACCEPTED":
      return "status-badge status-accepted";
    case "PROOF_SUBMITTED":
      return "status-badge status-proof";
    case "NEEDS_CHANGES":
    case "CHANGES_REQUESTED":
      return "status-badge status-changes";
    case "APPROVED":
    case "COMPLETED":
      return "status-badge status-completed";
    case "REJECT":
    case "REJECTED":
      return "status-badge status-rejected";
    default:
      return "status-badge";
  }
}

function canRoleMoveToStatus(role: Role, toStatus: TicketStatus): boolean {
  if (role === "ADMIN") {
    return true;
  }

  if (role === "QA") {
    return ["QUALIFIED", "PUBLISHED", "NEEDS_CHANGES", "COMPLETED", "REJECTED"].includes(toStatus);
  }

  if (role === "WORKER") {
    return ["ACCEPTED", "PROOF_SUBMITTED"].includes(toStatus);
  }

  return false;
}

function parseCoordinate(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function toggleIdInSelection(current: string[], id: string): string[] {
  if (current.includes(id)) {
    return current.filter((item) => item !== id);
  }
  return [...current, id];
}

function buildStaticMapUrl(params: {
  centerLat: number;
  centerLng: number;
  markers: Array<{ lat: number; lng: number; color: "red" | "blue" }>;
  zoom?: number;
  width?: number;
  height?: number;
}): string {
  const markerString = params.markers
    .map((marker) => `${marker.lat.toFixed(6)},${marker.lng.toFixed(6)},${marker.color}`)
    .join("|");

  const search = new URLSearchParams({
    center: `${params.centerLat.toFixed(6)},${params.centerLng.toFixed(6)}`,
    zoom: String(params.zoom ?? 14),
    size: `${params.width ?? 640}x${params.height ?? 320}`,
    markers: markerString
  });

  return `https://staticmap.openstreetmap.de/staticmap.php?${search.toString()}`;
}

function buildProofMapUrl(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) {
    return null;
  }
  return buildStaticMapUrl({
    centerLat: lat,
    centerLng: lng,
    markers: [{ lat, lng, color: "red" }],
    zoom: 16,
    width: 520,
    height: 220
  });
}

function MapPreviewImage(props: { src: string; alt: string; fallbackText: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <p className="map-fallback">{props.fallbackText}</p>;
  }

  return <img src={props.src} alt={props.alt} className="map-image" onError={() => setFailed(true)} />;
}

function App() {
  const [email, setEmail] = useState(roleEmails.REQUESTER);
  const [password, setPassword] = useState("demo123");
  const [token, setToken] = useState<string>("");
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState<View>("tickets");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [createTicketForm, setCreateTicketForm] = useState(defaultCreateTicket);
  const [proofForm, setProofForm] = useState(defaultProof);
  const [hintForm, setHintForm] = useState(defaultHintForm);
  const [qaComment, setQaComment] = useState("");

  const [workerLat, setWorkerLat] = useState("52.52");
  const [workerLng, setWorkerLng] = useState("13.405");
  const [workerRadius, setWorkerRadius] = useState("10");

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateForm, setTemplateForm] = useState(defaultTemplateForm);
  const [adminMetrics, setAdminMetrics] = useState<AdminMetrics | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTerm[]>([]);
  const [ticketProjectFilter, setTicketProjectFilter] = useState<string>("");
  const [ticketTaxonomyFilter, setTicketTaxonomyFilter] = useState<string[]>([]);
  const [ticketTaxonomyQuery, setTicketTaxonomyQuery] = useState<string>("");
  const [ticketDateFrom, setTicketDateFrom] = useState<string>("");
  const [ticketDateTo, setTicketDateTo] = useState<string>("");
  const [ticketProjectId, setTicketProjectId] = useState<string>("");
  const [hintProjectId, setHintProjectId] = useState<string>("");
  const [qaFlagFilter, setQaFlagFilter] = useState<"all" | "geo_fail" | "time_fail" | "exif_missing">("all");
  const [qaQueueEntries, setQaQueueEntries] = useState<QaQueueEntry[]>([]);
  const [proofImageUrls, setProofImageUrls] = useState<Record<string, string>>({});
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [draggingTicketId, setDraggingTicketId] = useState<string>("");

  const selectedTicket = useMemo(() => tickets.find((t) => t.id === selectedTicketId) ?? null, [tickets, selectedTicketId]);
  const createTicketMapUrl = useMemo(() => {
    const lat = parseCoordinate(createTicketForm.location_lat);
    const lng = parseCoordinate(createTicketForm.location_lng);
    if (lat == null || lng == null) {
      return null;
    }
    return buildStaticMapUrl({
      centerLat: lat,
      centerLng: lng,
      markers: [{ lat, lng, color: "red" }],
      zoom: 16,
      width: 640,
      height: 250
    });
  }, [createTicketForm.location_lat, createTicketForm.location_lng]);
  const workerMapUrl = useMemo(() => {
    const lat = parseCoordinate(workerLat);
    const lng = parseCoordinate(workerLng);
    if (lat == null || lng == null) {
      return null;
    }

    const ticketMarkers = tickets
      .slice(0, 20)
      .filter((ticket) => Number.isFinite(ticket.location_lat) && Number.isFinite(ticket.location_lng))
      .map((ticket) => ({ lat: ticket.location_lat, lng: ticket.location_lng, color: "red" as const }));

    return buildStaticMapUrl({
      centerLat: lat,
      centerLng: lng,
      markers: [{ lat, lng, color: "blue" }, ...ticketMarkers],
      zoom: 13,
      width: 640,
      height: 280
    });
  }, [workerLat, workerLng, tickets]);

  const setSession = (jwt: string) => {
    const decoded = decodeJwt(jwt);
    setToken(jwt);
    setUserRole(decoded.role as Role);
    setUserEmail(decoded.email);

    if (decoded.role === "WORKER") {
      setView("feed");
    } else if (decoded.role === "QA") {
      setView("qa");
    } else if (decoded.role === "ADMIN") {
      setView("admin");
    } else {
      setView("tickets");
    }
  };

  const resetMessages = () => {
    setError("");
    setMessage("");
  };

  const loadTickets = useCallback(async () => {
    if (!token || !userRole) {
      return;
    }

    if (view === "qa" || view === "help") {
      setTickets([]);
      return;
    }

    let params: Record<string, string | number> | undefined;
    if (view === "feed") {
      params = {
        near_lat: workerLat,
        near_lng: workerLng,
        near_radius_km: workerRadius
      };
    }
    if (view === "tickets" || view === "kanban") {
      const nextParams: Record<string, string | number> = {};
      if (ticketProjectFilter) {
        nextParams.project_id = ticketProjectFilter;
      }
      if (ticketTaxonomyFilter.length > 0) {
        nextParams.taxonomy_term_ids = ticketTaxonomyFilter.join(",");
      }
      if (ticketTaxonomyQuery.trim()) {
        nextParams.taxonomy_query = ticketTaxonomyQuery.trim();
      }
      if (ticketDateFrom) {
        nextParams.date_from = ticketDateFrom;
      }
      if (ticketDateTo) {
        nextParams.date_to = ticketDateTo;
      }
      params = Object.keys(nextParams).length > 0 ? nextParams : undefined;
    }

    const data = await listTickets(token, params);
    setTickets(data);

    if (selectedTicketId && !data.some((item) => item.id === selectedTicketId)) {
      setSelectedTicketId("");
      setTicketDetail(null);
    }
  }, [
    token,
    userRole,
    view,
    workerLat,
    workerLng,
    workerRadius,
    selectedTicketId,
    ticketProjectFilter,
    ticketTaxonomyFilter,
    ticketTaxonomyQuery,
    ticketDateFrom,
    ticketDateTo
  ]);

  const loadTicketDetail = useCallback(
    async (ticketId: string) => {
      if (!token || !ticketId) {
        return;
      }
      const detail = await getTicketDetail(token, ticketId);
      setTicketDetail(detail);
    },
    [token]
  );

  const loadAdminUsers = useCallback(async () => {
    if (!token || userRole !== "ADMIN") {
      return;
    }
    const users = await listUsers(token);
    setAdminUsers(users);
  }, [token, userRole]);

  const loadTemplates = useCallback(async () => {
    if (!token) {
      return;
    }
    const data = await listTemplates(token);
    setTemplates(data);
  }, [token]);

  const loadAdminMetrics = useCallback(async () => {
    if (!token || userRole !== "ADMIN") {
      return;
    }
    const metrics = await getAdminMetrics(token);
    setAdminMetrics(metrics);
  }, [token, userRole]);

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }
    const data = await listProjects(token);
    setProjects(data);
  }, [token]);

  const loadTaxonomyTerms = useCallback(async () => {
    if (!token) {
      return;
    }
    const data = await listTaxonomyTerms(token);
    setTaxonomyTerms(data);
  }, [token]);

  const loadQaQueue = useCallback(async () => {
    if (!token || userRole !== "QA") {
      setQaQueueEntries([]);
      return;
    }
    const entries = await listQaQueue(token, qaFlagFilter);
    setQaQueueEntries(entries);
  }, [token, userRole, qaFlagFilter]);

  const loadNotifications = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      return;
    }
    const items = await listNotifications(token, { unread_only: true, limit: 20 });
    setNotifications(items);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    resetMessages();
    setLoading(true);

    Promise.all([
      loadTickets(),
      loadAdminUsers(),
      loadTemplates(),
      loadAdminMetrics(),
      loadProjects(),
      loadTaxonomyTerms(),
      loadQaQueue(),
      loadNotifications()
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [
    token,
    view,
    reloadToken,
    loadTickets,
    loadAdminUsers,
    loadTemplates,
    loadAdminMetrics,
    loadProjects,
    loadTaxonomyTerms,
    loadQaQueue,
    loadNotifications
  ]);

  useEffect(() => {
    if (!selectedTicketId) {
      setTicketDetail(null);
      return;
    }
    loadTicketDetail(selectedTicketId).catch((err) => setError(err.message));
  }, [selectedTicketId, reloadToken, loadTicketDetail]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }

    if (!ticketProjectId) {
      setTicketProjectId(projects[0].id);
    }
    if (!hintProjectId) {
      setHintProjectId(projects[0].id);
    }
  }, [projects, ticketProjectId, hintProjectId]);

  useEffect(() => {
    let active = true;
    const localUrls: string[] = [];

    const revokeCurrent = () => {
      setProofImageUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
    };

    if (view !== "qa" || userRole !== "QA" || !token || !ticketDetail) {
      revokeCurrent();
      return;
    }

    const files = ticketDetail.proofs.flatMap((proof) =>
      (proof.files ?? []).map((file) => ({
        proofId: proof.id,
        fileId: file.id
      }))
    );

    if (files.length === 0) {
      revokeCurrent();
      return;
    }

    const loadImages = async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        files.map(async (fileRef) => {
          try {
            const blob = await downloadProofFile(token, fileRef.proofId, fileRef.fileId);
            const objectUrl = URL.createObjectURL(blob);
            localUrls.push(objectUrl);
            next[fileRef.fileId] = objectUrl;
          } catch (_error) {
            // Intentionally ignore single-file failures to keep the review usable.
          }
        })
      );

      if (!active) {
        localUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      setProofImageUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return next;
      });
    };

    loadImages().catch((err) => {
      if (active) {
        setError((err as Error).message);
      }
    });

    return () => {
      active = false;
      localUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [view, userRole, token, ticketDetail, reloadToken]);

  useEffect(() => {
    if (!token) {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }
    if (!("PushManager" in window)) {
      return;
    }
    if (!("Notification" in window)) {
      return;
    }

    const registerPush = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission !== "granted") {
          return;
        }

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({ userVisibleOnly: true });
        }

        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          return;
        }
        await savePushSubscription(token, {
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth
          }
        });
      } catch (_error) {
        // Web Push setup can fail on browsers without subscription support; polling notifications remains active.
      }
    };

    registerPush().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const interval = window.setInterval(() => {
      loadNotifications().catch(() => undefined);
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [token, loadNotifications]);

  useEffect(() => {
    if (notifications.length === 0) {
      return;
    }
    if (!("Notification" in window)) {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    notifications.slice(0, 3).forEach((item) => {
      const notification = new Notification(item.title, {
        body: item.body,
        tag: item.id
      });

      notification.onclick = () => {
        if (item.ticket_id) {
          setSelectedTicketId(item.ticket_id);
        }
      };
    });
  }, [notifications]);

  const onLogin = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      const response = await login(email, password);
      setSession(response.access_token);
      setMessage("Login erfolgreich.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onCreateTicket = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    resetMessages();
    setLoading(true);

    try {
      if (!ticketProjectId) {
        throw new Error("Bitte zuerst ein Projekt auswaehlen.");
      }

      const deadlineAt = toIsoFromDateAndTime(createTicketForm.deadline_date, createTicketForm.deadline_time, "Deadline");
      const timeWindowStart = toOptionalIsoFromDateAndTime(
        createTicketForm.time_window_start_date,
        createTicketForm.time_window_start_time
      );
      const timeWindowEnd = toOptionalIsoFromDateAndTime(
        createTicketForm.time_window_end_date,
        createTicketForm.time_window_end_time
      );

      await createTicket(token, {
        project_id: ticketProjectId,
        template_id: selectedTemplateId || null,
        title: createTicketForm.title,
        description: createTicketForm.description,
        category: createTicketForm.category,
        task_class: Number(createTicketForm.task_class),
        location_lat: Number(createTicketForm.location_lat),
        location_lng: Number(createTicketForm.location_lng),
        geofence_radius_m: Number(createTicketForm.geofence_radius_m),
        time_window_start: timeWindowStart,
        time_window_end: timeWindowEnd,
        deadline_at: deadlineAt,
        taxonomy_term_ids: createTicketForm.taxonomy_term_ids,
        proof_policy_json: JSON.parse(createTicketForm.proof_policy_json),
        safety_flags_json: JSON.parse(createTicketForm.safety_flags_json)
      });
      setMessage("Ticket erstellt.");
      setCreateTicketForm(defaultCreateTicket);
      setSelectedTemplateId("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onQualify = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await qualifyTicket(token, selectedTicket.id, {
        task_class: selectedTicket.task_class,
        proof_policy_json: selectedTicket.proof_policy_json
      });
      setMessage("Ticket qualifiziert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onPublish = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await publishTicket(token, selectedTicket.id);
      setMessage("Ticket publiziert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onAccept = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await acceptTicket(token, selectedTicket.id);
      setMessage("Ticket angenommen.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onSubmitProof = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const capturedAt = toOptionalIsoFromDateAndTime(proofForm.captured_date, proofForm.captured_time) ?? "";
      await submitProof(token, selectedTicket.id, {
        ...proofForm,
        captured_at: capturedAt
      });
      setMessage("Proof eingereicht.");
      setProofForm(defaultProof);
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onCreateHint = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || userRole !== "WORKER") {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      if (!hintProjectId) {
        throw new Error("Bitte ein Projekt fuer den Hinweis waehlen.");
      }
      if (hintForm.files.length === 0) {
        throw new Error("Bitte mindestens ein Foto anhaengen.");
      }

      const observedAt = toOptionalIsoFromDateAndTime(hintForm.observed_date, hintForm.observed_time) ?? undefined;
      const deadlineAt = toOptionalIsoFromDateAndTime(hintForm.deadline_date, hintForm.deadline_time) ?? undefined;

      await createHintTicket(token, {
        project_id: hintProjectId,
        title: hintForm.title,
        description: hintForm.description,
        category: hintForm.category,
        location_lat: hintForm.location_lat,
        location_lng: hintForm.location_lng,
        geofence_radius_m: hintForm.geofence_radius_m,
        observed_at: observedAt,
        deadline_at: deadlineAt,
        taxonomy_term_ids: hintForm.taxonomy_term_ids,
        files: hintForm.files
      });

      setHintForm(defaultHintForm);
      setMessage("Hinweis wurde als Ticket angelegt.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onKanbanMove = async (ticketId: string, toStatus: TicketStatus) => {
    if (!token || !userRole) {
      return;
    }
    if (toStatus === "NEW") {
      setError("Rueckverschiebung nach NEW ist im Kanban gesperrt.");
      return;
    }
    if (!canRoleMoveToStatus(userRole, toStatus)) {
      setError(`Rolle ${userRole} darf nicht auf ${toStatus} ziehen.`);
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await moveTicketStatus(token, ticketId, toStatus);
      setMessage(`Status auf ${toStatus} verschoben.`);
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setDraggingTicketId("");
    }
  };

  const onMarkNotificationRead = async (notificationId: string) => {
    if (!token) {
      return;
    }

    try {
      await markNotificationRead(token, notificationId);
      setNotifications((current) => current.filter((entry) => entry.id !== notificationId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onQaDecision = async (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "ESCALATE", proofId: string) => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();

    try {
      await qaDecision(token, proofId, { decision, comment: qaComment });
      setMessage(`QA Entscheidung gespeichert: ${decision}`);
      setQaComment("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadReport = async () => {
    if (!token || !selectedTicket) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const blob = await downloadReport(token, selectedTicket.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("Report geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadProjectReport = async () => {
    if (!token || !ticketProjectFilter) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const blob = await downloadProjectReport(token, ticketProjectFilter);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("Projekt-Report geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadKa5Csv = async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const blob = await downloadKa5Csv(token, {
        project_id: ticketProjectFilter || undefined,
        date_from: ticketDateFrom || undefined,
        date_to: ticketDateTo || undefined
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("KA5 CSV Export geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDownloadKa5Json = async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const data = await downloadKa5Json(token, {
        project_id: ticketProjectFilter || undefined,
        date_from: ticketDateFrom || undefined,
        date_to: ticketDateTo || undefined
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setMessage("KA5 JSON Export geoeffnet.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await createProject(token, {
        name: projectForm.name,
        description: projectForm.description
      });
      setProjectForm(defaultProjectForm);
      setMessage("Projekt erstellt.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onUpdateUserRole = async (userId: string, role: Role) => {
    if (!token) {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await updateUserRole(token, userId, role);
      setMessage("Rolle aktualisiert.");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onApplyTemplateToTicketForm = () => {
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) {
      return;
    }
    setCreateTicketForm((current) => ({
      ...current,
      category: template.category,
      task_class: template.task_class,
      geofence_radius_m: String(template.default_geofence_radius_m),
      proof_policy_json: JSON.stringify(template.proof_policy_json)
    }));
  };

  const onSelectTemplateForEdit = (template: TicketTemplate) => {
    setSelectedTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      category: template.category,
      task_class: template.task_class,
      checklist_json: JSON.stringify(template.checklist_json),
      proof_policy_json: JSON.stringify(template.proof_policy_json),
      default_geofence_radius_m: String(template.default_geofence_radius_m)
    });
  };

  const onSaveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || userRole !== "ADMIN") {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      const payload = {
        name: templateForm.name,
        category: templateForm.category,
        task_class: Number(templateForm.task_class),
        checklist_json: JSON.parse(templateForm.checklist_json),
        proof_policy_json: JSON.parse(templateForm.proof_policy_json),
        default_geofence_radius_m: Number(templateForm.default_geofence_radius_m)
      };

      if (selectedTemplateId && templates.some((item) => item.id === selectedTemplateId)) {
        await updateTemplate(token, selectedTemplateId, payload);
        setMessage("Template aktualisiert.");
      } else {
        await createTemplate(token, payload);
        setMessage("Template erstellt.");
      }

      setTemplateForm(defaultTemplateForm);
      setSelectedTemplateId("");
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onDeleteTemplate = async (templateId: string) => {
    if (!token || userRole !== "ADMIN") {
      return;
    }

    setLoading(true);
    resetMessages();
    try {
      await deleteTemplate(token, templateId);
      setMessage("Template geloescht.");
      if (selectedTemplateId === templateId) {
        setSelectedTemplateId("");
        setTemplateForm(defaultTemplateForm);
      }
      setReloadToken((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    Object.values(proofImageUrls).forEach((url) => URL.revokeObjectURL(url));
    setToken("");
    setUserRole(null);
    setUserEmail("");
    setTickets([]);
    setSelectedTicketId("");
    setTicketDetail(null);
    setHintForm(defaultHintForm);
    setAdminUsers([]);
    setTemplates([]);
    setSelectedTemplateId("");
    setTemplateForm(defaultTemplateForm);
    setAdminMetrics(null);
    setProjects([]);
    setProjectForm(defaultProjectForm);
    setTaxonomyTerms([]);
    setTicketProjectFilter("");
    setTicketTaxonomyFilter([]);
    setTicketTaxonomyQuery("");
    setTicketDateFrom("");
    setTicketDateTo("");
    setTicketProjectId("");
    setHintProjectId("");
    setQaQueueEntries([]);
    setQaFlagFilter("all");
    setProofImageUrls({});
    setNotifications([]);
    setDraggingTicketId("");
  };

  if (!token || !userRole) {
    return (
      <main className="shell login-shell">
        <section className="card login-card">
          <h1>Umwelt Compliance MVP</h1>
          <p>Login via Demo-User gemaess MVP-Setup.</p>
          <form onSubmit={onLogin} className="form-grid">
            <label>
              Rolle-Vorlage
              <select
                value={email}
                onChange={(e) => {
                  const selectedEmail = e.target.value;
                  setEmail(selectedEmail);
                }}
              >
                {Object.entries(roleEmails).map(([role, defaultEmail]) => (
                  <option value={defaultEmail} key={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Passwort
              <input value={password} onChange={(e) => setPassword(e.target.value)} required type="password" />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "Bitte warten..." : "Einloggen"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar card">
        <div className="topbar-title">
          <h2>Umwelt Compliance MVP</h2>
          <p className="subtle">Ticketing, Proof und QA in einem lesbaren Arbeitsbereich.</p>
          <div className="identity-row">
            <span>{userEmail}</span>
            <span className="role-pill">{userRole}</span>
          </div>
        </div>
        <nav className="nav-actions">
          {(userRole === "REQUESTER" || userRole === "ADMIN") && (
            <button onClick={() => setView("tickets")} className={view === "tickets" ? "active" : ""}>
              Tickets
            </button>
          )}
          {(userRole === "REQUESTER" || userRole === "ADMIN" || userRole === "QA") && (
            <button onClick={() => setView("kanban")} className={view === "kanban" ? "active" : ""}>
              Kanban
            </button>
          )}
          {userRole === "WORKER" && (
            <button onClick={() => setView("feed")} className={view === "feed" ? "active" : ""}>
              Mission Feed
            </button>
          )}
          {userRole === "QA" && (
            <button onClick={() => setView("qa")} className={view === "qa" ? "active" : ""}>
              QA Queue
            </button>
          )}
          {userRole === "ADMIN" && (
            <button onClick={() => setView("admin")} className={view === "admin" ? "active" : ""}>
              Admin
            </button>
          )}
          <button onClick={() => setView("help")} className={view === "help" ? "active" : ""}>
            Hilfe
          </button>
          <button onClick={logout}>Logout</button>
        </nav>
      </header>

      {(message || error) && (
        <section className="card">
          {message && <p className="ok">{message}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {notifications.length > 0 && (
        <section className="card">
          <h3>Benachrichtigungen</h3>
          <ul className="list">
            {notifications.map((entry) => (
              <li key={entry.id}>
                <div className="list-title-row">
                  <strong>{entry.title}</strong>
                  <button type="button" onClick={() => onMarkNotificationRead(entry.id)}>
                    gelesen
                  </button>
                </div>
                <div className="list-meta">{entry.body}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "tickets" && (userRole === "REQUESTER" || userRole === "ADMIN") && (
        <section className="grid-two">
          <article className="card">
            <h3>R-01 Ticket Liste</h3>
            <p className="subtle">Waehle ein Ticket fuer Detailansicht, Timeline und Report.</p>
            <div className="inline-fields">
              <label>
                Projektfilter
                <select value={ticketProjectFilter} onChange={(e) => setTicketProjectFilter(e.target.value)}>
                  <option value="">- alle Projekte -</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Taxonomie (Mehrfachauswahl)
                <div className="pill-row">
                  {taxonomyTerms.filter((term) => term.active).map((term) => (
                    <button
                      key={`filter-${term.id}`}
                      type="button"
                      className={`tag-pill ${ticketTaxonomyFilter.includes(term.id) ? "active" : ""}`}
                      title={`${term.domain}: ${term.label}`}
                      onClick={() => setTicketTaxonomyFilter((current) => toggleIdInSelection(current, term.id))}
                    >
                      {term.label}
                    </button>
                  ))}
                </div>
                <span className="subtle">
                  {ticketTaxonomyFilter.length > 0
                    ? `${ticketTaxonomyFilter.length} Tag(s) aktiv`
                    : "Kein Taxonomie-Filter aktiv"}
                </span>
              </label>
              <label>
                Suchbegriff (Tag)
                <input
                  value={ticketTaxonomyQuery}
                  onChange={(e) => setTicketTaxonomyQuery(e.target.value)}
                  placeholder="z. B. Luzerne"
                />
              </label>
              <label>
                Datum von
                <input type="date" value={ticketDateFrom} onChange={(e) => setTicketDateFrom(e.target.value)} />
              </label>
              <label>
                Datum bis
                <input type="date" value={ticketDateTo} onChange={(e) => setTicketDateTo(e.target.value)} />
              </label>
              <button type="button" onClick={() => setReloadToken((v) => v + 1)}>
                Filter anwenden
              </button>
              <button type="button" onClick={onDownloadProjectReport} disabled={!ticketProjectFilter}>
                Projekt-Report (PDF)
              </button>
              <button type="button" onClick={onDownloadKa5Csv}>
                KA5 CSV
              </button>
              <button type="button" onClick={onDownloadKa5Json}>
                KA5 JSON
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Titel</th>
                    <th>Kategorie</th>
                    <th>Tags</th>
                    <th>Klasse</th>
                    <th>Status</th>
                    <th>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => (
                    <tr
                      key={ticket.id}
                      className={ticket.id === selectedTicketId ? "selected-row" : ""}
                      onClick={() => setSelectedTicketId(ticket.id)}
                    >
                      <td>{ticket.title}</td>
                      <td>{ticket.category}</td>
                      <td>{ticket.taxonomy_terms.map((term) => term.label).join(", ") || "-"}</td>
                      <td>{ticket.task_class}</td>
                      <td>
                        <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                      </td>
                      <td>{formatDate(ticket.deadline_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card">
            <h3>R-02 Neues Ticket</h3>
            <p className="subtle">Pflichtfelder zuerst ausfuellen, dann optionale JSON-Policies verfeinern.</p>
            <form onSubmit={onCreateTicket} className="form-grid">
              <label>
                Projekt (Pflicht)
                <select value={ticketProjectId} onChange={(e) => setTicketProjectId(e.target.value)} required>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Template (optional)
                <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                  <option value="">- kein Template -</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={onApplyTemplateToTicketForm} disabled={!selectedTemplateId}>
                Template-Werte uebernehmen
              </button>
              <label>
                Titel
                <input
                  value={createTicketForm.title}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, title: e.target.value }))}
                  required
                />
              </label>
              <label>
                Beschreibung
                <textarea
                  value={createTicketForm.description}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, description: e.target.value }))}
                />
              </label>
              <label>
                Kategorie
                <input
                  value={createTicketForm.category}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, category: e.target.value }))}
                  required
                />
              </label>
              <div className="pill-row">
                {categoryPills.map((pill) => (
                  <button
                    key={pill}
                    type="button"
                    className={`tag-pill ${createTicketForm.category === pill ? "active" : ""}`}
                    onClick={() => setCreateTicketForm((v) => ({ ...v, category: pill }))}
                  >
                    {pill}
                  </button>
                ))}
              </div>
              <label>
                Task-Klasse
                <select
                  value={createTicketForm.task_class}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, task_class: Number(e.target.value) }))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label>
                Breitengrad (Lat)
                <input
                  type="number"
                  step="0.000001"
                  value={createTicketForm.location_lat}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, location_lat: e.target.value }))}
                  required
                />
              </label>
              <label>
                Laengengrad (Lng)
                <input
                  type="number"
                  step="0.000001"
                  value={createTicketForm.location_lng}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, location_lng: e.target.value }))}
                  required
                />
              </label>
              {createTicketMapUrl && (
                <div className="map-block">
                  <p className="map-caption">Standort-Vorschau (R-02)</p>
                  <MapPreviewImage
                    src={createTicketMapUrl}
                    alt="Ticket-Standort auf Karte"
                    fallbackText="Karte konnte nicht geladen werden. Bitte Koordinaten im Formular pruefen."
                  />
                </div>
              )}
              <label>
                Geofence Radius (m)
                <input
                  type="number"
                  value={createTicketForm.geofence_radius_m}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, geofence_radius_m: e.target.value }))}
                  required
                />
              </label>
              <label>
                Time Window Start - Datum (optional)
                <input
                  type="date"
                  value={createTicketForm.time_window_start_date}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_start_date: e.target.value }))}
                />
              </label>
              <label>
                Time Window Start - Uhrzeit (optional)
                <input
                  type="time"
                  value={createTicketForm.time_window_start_time}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_start_time: e.target.value }))}
                />
              </label>
              <label>
                Time Window End - Datum (optional)
                <input
                  type="date"
                  value={createTicketForm.time_window_end_date}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_end_date: e.target.value }))}
                />
              </label>
              <label>
                Time Window End - Uhrzeit (optional)
                <input
                  type="time"
                  value={createTicketForm.time_window_end_time}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, time_window_end_time: e.target.value }))}
                />
              </label>
              <label>
                Deadline - Datum
                <input
                  type="date"
                  value={createTicketForm.deadline_date}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, deadline_date: e.target.value }))}
                  required
                />
              </label>
              <label>
                Deadline - Uhrzeit
                <input
                  type="time"
                  value={createTicketForm.deadline_time}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, deadline_time: e.target.value }))}
                  required
                />
              </label>
              <label>
                Taxonomie-Tags (Mehrfachauswahl)
                <div className="pill-row">
                  {taxonomyTerms
                    .filter((term) => term.active)
                    .map((term) => (
                      <button
                        key={`create-term-${term.id}`}
                        type="button"
                        className={`tag-pill ${createTicketForm.taxonomy_term_ids.includes(term.id) ? "active" : ""}`}
                        title={`${term.domain}: ${term.label}`}
                        onClick={() =>
                          setCreateTicketForm((v) => ({
                            ...v,
                            taxonomy_term_ids: toggleIdInSelection(v.taxonomy_term_ids, term.id)
                          }))
                        }
                      >
                        {term.label}
                      </button>
                    ))}
                </div>
                <span className="subtle">{createTicketForm.taxonomy_term_ids.length} Tag(s) ausgewaehlt</span>
              </label>
              <label>
                Proof Policy JSON
                <textarea
                  value={createTicketForm.proof_policy_json}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, proof_policy_json: e.target.value }))}
                  required
                />
              </label>
              <label>
                Safety Flags JSON
                <textarea
                  value={createTicketForm.safety_flags_json}
                  onChange={(e) => setCreateTicketForm((v) => ({ ...v, safety_flags_json: e.target.value }))}
                  required
                />
              </label>
              <p className="subtle">
                Hilfe zu Taxonomie, Proof Policy und Safety Flags findest du im Tab "Hilfe" unter "FAQ / Hilfe".
              </p>
              <button type="submit" disabled={loading}>
                Ticket erstellen
              </button>
            </form>

              <h4>Projekt anlegen</h4>
              <p className="subtle">Projekte helfen beim Filtern und Projekt-Report.</p>
              <form onSubmit={onCreateProject} className="form-grid">
              <label>
                Projektname
                <input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((v) => ({ ...v, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                Beschreibung
                <textarea
                  value={projectForm.description}
                  onChange={(e) => setProjectForm((v) => ({ ...v, description: e.target.value }))}
                />
              </label>
              <button type="submit" disabled={loading}>
                Projekt speichern
              </button>
            </form>
          </article>

          <article className="card full-width">
            <h3>R-03 Ticket Detail</h3>
            {!ticketDetail && <p>Ticket in der Liste auswaehlen.</p>}
            {ticketDetail && (
              <>
                <p>
                  <strong>Status:</strong> <span className={getStatusBadgeClass(ticketDetail.status)}>{ticketDetail.status}</span>
                </p>
                <p>
                  <strong>Origin:</strong> {ticketDetail.origin}
                </p>
                {ticketDetail.hint_note && (
                  <p>
                    <strong>Hinweis:</strong> {ticketDetail.hint_note}
                  </p>
                )}
                <p>
                  <strong>Taxonomie:</strong> {ticketDetail.taxonomy_terms.map((term) => term.label).join(", ") || "-"}
                </p>
                <p>
                  <strong>Proofs:</strong> {ticketDetail.proofs.length}
                </p>
                <div className="button-row">
                  <button onClick={onDownloadReport}>Report (PDF)</button>
                  {userRole === "ADMIN" && ticketDetail.status === "NEW" && <button onClick={onQualify}>Qualify</button>}
                  {userRole === "ADMIN" && (ticketDetail.status === "QUALIFIED" || ticketDetail.status === "REJECTED") && (
                    <button onClick={onPublish}>Publish</button>
                  )}
                </div>
                <h4>Timeline</h4>
                <ul className="timeline">
                  {ticketDetail.status_events.map((event) => (
                    <li key={event.id}>
                      <span>{formatDate(event.created_at)}</span>
                      <span>
                        {(event.from_status ?? "-")} -&gt; {event.to_status}
                      </span>
                      <span>{event.event_type}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </section>
      )}

      {view === "kanban" && (userRole === "REQUESTER" || userRole === "ADMIN" || userRole === "QA") && (
        <section className="card">
          <h3>Kanban Board</h3>
          <p className="subtle">Status per Drag&Drop verschieben. Serverseitig gelten weiterhin strikte Transitionen und RBAC.</p>
          <div className="inline-fields">
            <label>
              Projektfilter
              <select value={ticketProjectFilter} onChange={(e) => setTicketProjectFilter(e.target.value)}>
                <option value="">- alle Projekte -</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Taxonomie (Mehrfachauswahl)
              <div className="pill-row">
                {taxonomyTerms.filter((term) => term.active).map((term) => (
                  <button
                    key={`kanban-filter-${term.id}`}
                    type="button"
                    className={`tag-pill ${ticketTaxonomyFilter.includes(term.id) ? "active" : ""}`}
                    title={`${term.domain}: ${term.label}`}
                    onClick={() => setTicketTaxonomyFilter((current) => toggleIdInSelection(current, term.id))}
                  >
                    {term.label}
                  </button>
                ))}
              </div>
              <span className="subtle">
                {ticketTaxonomyFilter.length > 0
                  ? `${ticketTaxonomyFilter.length} Tag(s) aktiv`
                  : "Kein Taxonomie-Filter aktiv"}
              </span>
            </label>
            <button type="button" onClick={() => setReloadToken((v) => v + 1)}>
              Board aktualisieren
            </button>
          </div>
          <div className="kanban-board">
            {kanbanColumns.map((columnStatus) => (
              <section
                key={columnStatus}
                className="kanban-column"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggingTicketId) {
                    return;
                  }
                  const ticket = tickets.find((item) => item.id === draggingTicketId);
                  if (!ticket || ticket.status === columnStatus) {
                    setDraggingTicketId("");
                    return;
                  }
                  onKanbanMove(ticket.id, columnStatus);
                }}
              >
                <header>
                  <strong>{columnStatus}</strong>
                  <span>{tickets.filter((ticket) => ticket.status === columnStatus).length}</span>
                </header>
                <div className="kanban-cards">
                  {tickets
                    .filter((ticket) => ticket.status === columnStatus)
                    .map((ticket) => (
                      <article
                        key={ticket.id}
                        className="kanban-card"
                        draggable={userRole !== "REQUESTER"}
                        onDragStart={() => setDraggingTicketId(ticket.id)}
                        onDragEnd={() => setDraggingTicketId("")}
                      >
                        <div className="list-title-row">
                          <strong>{ticket.title}</strong>
                          <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                        </div>
                        <div className="list-meta">{ticket.category}</div>
                        <div className="list-meta">{ticket.taxonomy_terms.map((term) => term.label).join(", ") || "-"}</div>
                        <div className="list-meta">Deadline {formatDate(ticket.deadline_at)}</div>
                      </article>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      {view === "feed" && userRole === "WORKER" && (
        <section className="grid-two">
          <article className="card">
            <h3>W-01 Mission Feed</h3>
            <p className="subtle">Missionsliste nach Distanz. Ticket antippen fuer Details und Annahme.</p>
            <div className="inline-fields">
              <label>
                Breitengrad
                <input value={workerLat} onChange={(e) => setWorkerLat(e.target.value)} />
              </label>
              <label>
                Laengengrad
                <input value={workerLng} onChange={(e) => setWorkerLng(e.target.value)} />
              </label>
              <label>
                Distanz km
                <input value={workerRadius} onChange={(e) => setWorkerRadius(e.target.value)} />
              </label>
              <button onClick={() => setReloadToken((v) => v + 1)}>Feed laden</button>
            </div>
            {workerMapUrl && (
              <div className="map-block">
                <p className="map-caption">W-01 Karte (blau = Worker, rot = Missionen)</p>
                <MapPreviewImage
                  src={workerMapUrl}
                  alt="Mission Feed Karte mit Worker und Tickets"
                  fallbackText="Karte konnte nicht geladen werden. Liste bleibt nach Distanz nutzbar."
                />
              </div>
            )}
            <ul className="list">
              {tickets.map((ticket) => (
                <li key={ticket.id} onClick={() => setSelectedTicketId(ticket.id)} className={ticket.id === selectedTicketId ? "active" : ""}>
                  <div className="list-title-row">
                    <strong>{ticket.title}</strong>
                    <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                  </div>
                  <div className="list-meta">
                    {ticket.category} | Klasse {ticket.task_class} | Deadline {formatDate(ticket.deadline_at)}
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h3>W-02 / W-03 Ticket Detail & Active Ticket</h3>
            {!selectedTicket && <p>Ticket aus dem Feed auswaehlen.</p>}
            {selectedTicket && (
              <>
                <div className="list-title-row">
                  <strong>{selectedTicket.title}</strong>
                  <span className={getStatusBadgeClass(selectedTicket.status)}>{selectedTicket.status}</span>
                </div>
                <p>
                  Geofence: {selectedTicket.geofence_radius_m}m | Deadline: {formatDate(selectedTicket.deadline_at)}
                </p>
                <p>
                  Origin: {selectedTicket.origin} | Tags: {selectedTicket.taxonomy_terms.map((term) => term.label).join(", ") || "-"}
                </p>
                {selectedTicket.hint_note && <p>Hinweis: {selectedTicket.hint_note}</p>}
                <div className="json-panel">
                  <strong>Proof Policy</strong>
                  <pre className="json-block">{JSON.stringify(selectedTicket.proof_policy_json, null, 2)}</pre>
                </div>
                <div className="json-panel">
                  <strong>Safety Flags</strong>
                  <pre className="json-block">{JSON.stringify(selectedTicket.safety_flags_json, null, 2)}</pre>
                </div>

                {selectedTicket.status === "PUBLISHED" && <button onClick={onAccept}>Annehmen</button>}

                {(selectedTicket.status === "ACCEPTED" ||
                  selectedTicket.status === "NEEDS_CHANGES" ||
                  selectedTicket.status === "PROOF_SUBMITTED") && (
                  <form onSubmit={onSubmitProof} className="form-grid">
                    <label>
                      Notizen
                      <textarea value={proofForm.notes} onChange={(e) => setProofForm((v) => ({ ...v, notes: e.target.value }))} />
                    </label>
                    <label>
                      Checkliste (JSON)
                      <textarea
                        value={proofForm.checklist_answers_json}
                        onChange={(e) => setProofForm((v) => ({ ...v, checklist_answers_json: e.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      GPS Breitengrad
                      <input value={proofForm.gps_lat} onChange={(e) => setProofForm((v) => ({ ...v, gps_lat: e.target.value }))} />
                    </label>
                    <label>
                      GPS Laengengrad
                      <input value={proofForm.gps_lng} onChange={(e) => setProofForm((v) => ({ ...v, gps_lng: e.target.value }))} />
                    </label>
                    <label>
                      Aufnahmezeit - Datum
                      <input
                        type="date"
                        value={proofForm.captured_date}
                        onChange={(e) => setProofForm((v) => ({ ...v, captured_date: e.target.value }))}
                      />
                    </label>
                    <label>
                      Aufnahmezeit - Uhrzeit
                      <input
                        type="time"
                        value={proofForm.captured_time}
                        onChange={(e) => setProofForm((v) => ({ ...v, captured_time: e.target.value }))}
                      />
                    </label>
                    <label>
                      Fotos (mindestens gemaess Policy)
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => setProofForm((v) => ({ ...v, files: Array.from(e.target.files ?? []) }))}
                        required
                      />
                    </label>
                    <button type="submit" disabled={loading}>
                      Proof submitten
                    </button>
                  </form>
                )}

                {selectedTicket.status === "NEEDS_CHANGES" && ticketDetail && (
                  <div className="notice">
                    <h4>W-04 Proof Status</h4>
                    <p>Nachbesserung erforderlich. Letzte QA Kommentare:</p>
                    <ul>
                      {ticketDetail.proofs.map((proof) => (
                        <li key={proof.id}>
                          {proof.qa_status} - {proof.qa_comment || "-"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </article>

          <article className="card full-width">
            <h3>W-00 Misstand melden (Bottom-up)</h3>
            <p className="subtle">
              Pflicht: Text + Standort + mindestens ein Foto. Der Hinweis wird als neues Klasse-2 Ticket angelegt.
            </p>
            <form onSubmit={onCreateHint} className="form-grid">
              <label>
                Projekt (Pflicht)
                <select value={hintProjectId} onChange={(e) => setHintProjectId(e.target.value)} required>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Titel
                <input value={hintForm.title} onChange={(e) => setHintForm((v) => ({ ...v, title: e.target.value }))} required />
              </label>
              <label>
                Beschreibung (Pflicht)
                <textarea
                  value={hintForm.description}
                  onChange={(e) => setHintForm((v) => ({ ...v, description: e.target.value }))}
                  required
                />
              </label>
              <label>
                Kategorie
                <input
                  value={hintForm.category}
                  onChange={(e) => setHintForm((v) => ({ ...v, category: e.target.value }))}
                  required
                />
              </label>
              <div className="pill-row">
                {categoryPills.map((pill) => (
                  <button
                    key={`hint-${pill}`}
                    type="button"
                    className={`tag-pill ${hintForm.category === pill ? "active" : ""}`}
                    onClick={() => setHintForm((v) => ({ ...v, category: pill }))}
                  >
                    {pill}
                  </button>
                ))}
              </div>
              <label>
                Breitengrad
                <input value={hintForm.location_lat} onChange={(e) => setHintForm((v) => ({ ...v, location_lat: e.target.value }))} required />
              </label>
              <label>
                Laengengrad
                <input value={hintForm.location_lng} onChange={(e) => setHintForm((v) => ({ ...v, location_lng: e.target.value }))} required />
              </label>
              <label>
                Geofence Radius (m)
                <input
                  value={hintForm.geofence_radius_m}
                  onChange={(e) => setHintForm((v) => ({ ...v, geofence_radius_m: e.target.value }))}
                  required
                />
              </label>
              <label>
                Beobachtet am (Datum, optional)
                <input
                  type="date"
                  value={hintForm.observed_date}
                  onChange={(e) => setHintForm((v) => ({ ...v, observed_date: e.target.value }))}
                />
              </label>
              <label>
                Beobachtet um (Uhrzeit, optional)
                <input
                  type="time"
                  value={hintForm.observed_time}
                  onChange={(e) => setHintForm((v) => ({ ...v, observed_time: e.target.value }))}
                />
              </label>
              <label>
                Deadline (Datum, optional)
                <input
                  type="date"
                  value={hintForm.deadline_date}
                  onChange={(e) => setHintForm((v) => ({ ...v, deadline_date: e.target.value }))}
                />
              </label>
              <label>
                Deadline (Uhrzeit, optional)
                <input
                  type="time"
                  value={hintForm.deadline_time}
                  onChange={(e) => setHintForm((v) => ({ ...v, deadline_time: e.target.value }))}
                />
              </label>
              <label>
                Taxonomie-Tags (Mehrfachauswahl)
                <div className="pill-row">
                  {taxonomyTerms
                    .filter((term) => term.active)
                    .map((term) => (
                      <button
                        key={`hint-term-${term.id}`}
                        type="button"
                        className={`tag-pill ${hintForm.taxonomy_term_ids.includes(term.id) ? "active" : ""}`}
                        title={`${term.domain}: ${term.label}`}
                        onClick={() =>
                          setHintForm((v) => ({
                            ...v,
                            taxonomy_term_ids: toggleIdInSelection(v.taxonomy_term_ids, term.id)
                          }))
                        }
                      >
                        {term.label}
                      </button>
                    ))}
                </div>
                <span className="subtle">{hintForm.taxonomy_term_ids.length} Tag(s) ausgewaehlt</span>
              </label>
              <label>
                Fotos (Pflicht)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setHintForm((v) => ({ ...v, files: Array.from(e.target.files ?? []) }))}
                  required
                />
              </label>
              <button type="submit" disabled={loading}>
                Hinweis als Ticket erstellen
              </button>
            </form>
          </article>
        </section>
      )}

      {view === "qa" && userRole === "QA" && (
        <section className="grid-two">
          <article className="card">
            <h3>Q-01 QA Queue</h3>
            <p className="subtle">Offene Proofs nach Flag filtern und in der rechten Spalte pruefen.</p>
            <label>
              Flag-Filter
              <select
                value={qaFlagFilter}
                onChange={(e) => {
                  setQaFlagFilter(e.target.value as "all" | "geo_fail" | "time_fail" | "exif_missing");
                  setReloadToken((v) => v + 1);
                }}
              >
                <option value="all">Alle</option>
                <option value="geo_fail">geo_fail</option>
                <option value="time_fail">time_fail</option>
                <option value="exif_missing">exif_missing</option>
              </select>
            </label>
            <ul className="list">
              {qaQueueEntries.map((entry) => (
                <li
                  key={entry.proof_id}
                  onClick={() => setSelectedTicketId(entry.ticket_id)}
                  className={entry.ticket_id === selectedTicketId ? "active" : ""}
                >
                  <div className="list-title-row">
                    <strong>{entry.ticket_title}</strong>
                    <span className={getStatusBadgeClass(entry.qa_status)}>{entry.qa_status}</span>
                  </div>
                  <div className="list-meta">
                    {entry.category} | Eingereicht: {formatDate(entry.submitted_at)}
                  </div>
                  <div className="list-meta">
                    Proof: {entry.proof_id} | Worker: {entry.submitted_by_user_id}
                  </div>
                </li>
              ))}
            </ul>
            {qaQueueEntries.length === 0 && <p>Keine Proofs in der Queue.</p>}
          </article>
          <article className="card">
            <h3>Q-02 QA Review</h3>
            {!ticketDetail && <p>Ticket in der Queue auswaehlen.</p>}
            {ticketDetail && (
              <>
                {ticketDetail.proofs.length === 0 && <p>Keine Proofs.</p>}
                {ticketDetail.proofs.map((proof) => (
                  <div className="proof-card" key={proof.id}>
                    <div className="list-title-row">
                      <strong>Proof: {proof.id}</strong>
                      <span className={getStatusBadgeClass(proof.qa_status)}>{proof.qa_status}</span>
                    </div>
                    <p>
                      <strong>Worker:</strong> {proof.submitted_by_user_id}
                    </p>
                    <div className="json-panel">
                      <strong>Validation Flags</strong>
                      <pre className="json-block">{JSON.stringify(proof.validation_flags_json, null, 2)}</pre>
                    </div>
                    <div className="json-panel">
                      <strong>Checkliste</strong>
                      <pre className="json-block">{JSON.stringify(proof.checklist_answers_json, null, 2)}</pre>
                    </div>
                    <p>
                      <strong>Captured:</strong> {formatDate(proof.captured_at)}
                    </p>
                    <p>
                      <strong>GPS:</strong> {proof.gps_lat ?? "-"}, {proof.gps_lng ?? "-"}
                    </p>
                    <div className="proof-media-grid">
                      {(proof.files ?? []).map((file) => (
                        <figure key={file.id} className="proof-image">
                          {proofImageUrls[file.id] ? (
                            <img src={proofImageUrls[file.id]} alt={`Proof Datei ${file.file_key}`} className="proof-thumb" />
                          ) : (
                            <div className="proof-thumb loading">Bild wird geladen...</div>
                          )}
                          <figcaption>{file.file_key}</figcaption>
                        </figure>
                      ))}
                      {(proof.files ?? []).length === 0 && <p>Keine Fotos vorhanden.</p>}
                    </div>
                    {buildProofMapUrl(proof.gps_lat, proof.gps_lng) ? (
                      <div className="map-block">
                        <p className="map-caption">Map Preview</p>
                        <MapPreviewImage
                          src={buildProofMapUrl(proof.gps_lat, proof.gps_lng)!}
                          alt="Proof-Position auf Karte"
                          fallbackText="Map Preview nicht verfuegbar. GPS-Werte sind oberhalb sichtbar."
                        />
                      </div>
                    ) : (
                      <p>Map Preview: GPS fehlt.</p>
                    )}
                    <div className="button-row">
                      <button onClick={() => onQaDecision("APPROVE", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Approve
                      </button>
                      <button
                        onClick={() => onQaDecision("REQUEST_CHANGES", proof.id)}
                        disabled={proof.qa_status !== "PENDING"}
                      >
                        Request Changes
                      </button>
                      <button onClick={() => onQaDecision("REJECT", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Reject
                      </button>
                      <button onClick={() => onQaDecision("ESCALATE", proof.id)} disabled={proof.qa_status !== "PENDING"}>
                        Escalate
                      </button>
                    </div>
                  </div>
                ))}
                <label>
                  QA Kommentar
                  <textarea
                    value={qaComment}
                    onChange={(e) => setQaComment(e.target.value)}
                    placeholder="Pflicht bei Request Changes, Reject und Escalate."
                  />
                </label>
              </>
            )}
          </article>
        </section>
      )}

      {view === "admin" && userRole === "ADMIN" && (
        <section className="grid-two">
          <article className="card">
            <h3>Admin - KPI Snapshot</h3>
            {!adminMetrics && <p>Keine Metriken geladen.</p>}
            {adminMetrics && (
              <>
                <p className="subtle">Erzeugt: {formatDate(adminMetrics.generated_at)}</p>
                <div className="metric-grid">
                  <article className="metric-item">
                    <span>Tickets</span>
                    <strong>{adminMetrics.totals.tickets}</strong>
                  </article>
                  <article className="metric-item">
                    <span>Proofs</span>
                    <strong>{adminMetrics.totals.proofs}</strong>
                  </article>
                  <article className="metric-item">
                    <span>QA entschieden</span>
                    <strong>{adminMetrics.totals.qa_decided_proofs}</strong>
                  </article>
                  <article className="metric-item">
                    <span>Median Ticket-&gt;Accept</span>
                    <strong>{formatSeconds(adminMetrics.kpis.median_ticket_to_accepted_seconds)}</strong>
                  </article>
                  <article className="metric-item">
                    <span>First-Pass-Quote</span>
                    <strong>{formatPercent(adminMetrics.kpis.first_pass_proof_complete_rate)}</strong>
                  </article>
                  <article className="metric-item">
                    <span>QA Durchlaufzeit</span>
                    <strong>{formatSeconds(adminMetrics.kpis.avg_qa_cycle_seconds)}</strong>
                  </article>
                  <article className="metric-item">
                    <span>Nachforderungsrate</span>
                    <strong>{formatPercent(adminMetrics.kpis.change_request_rate)}</strong>
                  </article>
                </div>
              </>
            )}
          </article>

          <article className="card">
            <h3>Admin - User Rollen</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Rolle</th>
                    <th>Verified</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.display_name ?? "-"}</td>
                      <td>
                        <select
                          value={user.role}
                          onChange={(e) => {
                            const nextRole = e.target.value as Role;
                            setAdminUsers((current) =>
                              current.map((row) => (row.id === user.id ? { ...row, role: nextRole } : row))
                            );
                          }}
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="REQUESTER">REQUESTER</option>
                          <option value="WORKER">WORKER</option>
                          <option value="QA">QA</option>
                        </select>
                      </td>
                      <td>{user.is_verified ? "ja" : "nein"}</td>
                      <td>
                        <button onClick={() => onUpdateUserRole(user.id, user.role)}>Speichern</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card full-width">
            <h3>Admin - Templates</h3>
            <form onSubmit={onSaveTemplate} className="form-grid">
              <label>
                Name
                <input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                Kategorie
                <input
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, category: e.target.value }))}
                  required
                />
              </label>
              <label>
                Task-Klasse
                <select
                  value={templateForm.task_class}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, task_class: Number(e.target.value) }))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <label>
                Geofence Default (m)
                <input
                  type="number"
                  value={templateForm.default_geofence_radius_m}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, default_geofence_radius_m: e.target.value }))}
                  required
                />
              </label>
              <label>
                Checklist JSON
                <textarea
                  value={templateForm.checklist_json}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, checklist_json: e.target.value }))}
                />
              </label>
              <label>
                Proof Policy JSON
                <textarea
                  value={templateForm.proof_policy_json}
                  onChange={(e) => setTemplateForm((v) => ({ ...v, proof_policy_json: e.target.value }))}
                />
              </label>
              <div className="button-row">
                <button type="submit">{selectedTemplateId ? "Template updaten" : "Template erstellen"}</button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId("");
                    setTemplateForm(defaultTemplateForm);
                  }}
                >
                  Formular leeren
                </button>
              </div>
            </form>

            <h4>Vorhandene Templates</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kategorie</th>
                    <th>Klasse</th>
                    <th>Geofence</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr key={template.id}>
                      <td>{template.name}</td>
                      <td>{template.category}</td>
                      <td>{template.task_class}</td>
                      <td>{template.default_geofence_radius_m}</td>
                      <td>
                        <div className="button-row">
                          <button type="button" onClick={() => onSelectTemplateForEdit(template)}>
                            Bearbeiten
                          </button>
                          <button type="button" onClick={() => onDeleteTemplate(template.id)}>
                            Loeschen
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {view === "help" && (
        <section className="grid-two">
          <article className="card">
            <h3>Onboarding</h3>
            <ol className="timeline">
              <li>
                <span>1. Projekt waehlen</span>
                <span>Jede Aufgabe ist einem Projekt zugeordnet.</span>
              </li>
              <li>
                <span>2. Ticket erstellen oder Hinweis melden</span>
                <span>Requester erstellt Aufgaben, Worker melden Misstaende bottom-up.</span>
              </li>
              <li>
                <span>3. Umsetzung mit Proof</span>
                <span>Fotos, Standort und Zeit erfassen; QA prueft die Nachweise.</span>
              </li>
              <li>
                <span>4. Kanban und Exporte</span>
                <span>Statusuebersicht per Board, KA5-nahe CSV/JSON Exporte fuer Drittsysteme.</span>
              </li>
            </ol>
          </article>
          <article className="card">
            <h3>FAQ / Hilfe</h3>
            <div className="faq-list">
              <h4>Warum sehe ich frueher \"invalid datetime\"?</h4>
              <p>Die App nutzt jetzt getrennte Datum/Uhrzeit-Felder und sendet normalisierte ISO-Zeitstempel.</p>
              <h4>Taxonomie-Tags: wofuer sind sie da?</h4>
              <p>
                Taxonomie-Tags klassifizieren Tickets fachlich (z. B. Luzerne, Reifen, Verschmutzung), damit du spaeter
                sicher filtern, suchen und reporten kannst.
              </p>
              <p>
                In Ticket- und Hinweisformularen ist die Auswahl als Tag-Pills umgesetzt. Du kannst mehrere Tags anklicken;
                aktive Tags sind farblich markiert.
              </p>
              <h4>Was bedeutet `proof_policy_json`?</h4>
              <p>
                Dieses JSON steuert, welche Nachweise fuer das Ticket erforderlich sind. Wichtige Felder:
                `min_photos`, `require_gps`, `redundancy`, `required_fields`.
              </p>
              <pre className="json-block">
{`{
  "min_photos": 2,
  "require_gps": true,
  "redundancy": 1,
  "required_fields": ["checklist_complete"]
}`}
              </pre>
              <h4>Was bedeutet `safety_flags_json`?</h4>
              <p>
                Dieses JSON beschreibt Sicherheits- und Zugangsbedingungen vor Ort. Beispiel-Felder:
                `public_access_only`, `permit_required`, `no_trespass`.
              </p>
              <pre className="json-block">
{`{
  "public_access_only": true,
  "permit_required": false,
  "no_trespass": true
}`}
              </pre>
              <h4>Was trage ich bei Kategorie ein?</h4>
              <p>Nutze die Tag-Pills: Vegetation, Boden, Abfall, Erosion, Wasser, Sicherheit, Bohrstock, Luzerne, Schadstelle, Monitoring.</p>
              <h4>Wer bekommt Klasse-3 Hinweise?</h4>
              <p>Benachrichtigungen gehen an QA und fachliche Requester-Rolle.</p>
              <h4>Wie finde ich Luzerne-Faelle?</h4>
              <p>In der Ticketliste/kanban ueber Taxonomie-Filter oder Suchfeld \"Luzerne\" plus Datumsfilter.</p>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
