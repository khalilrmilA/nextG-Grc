/**
 * NotificationBell — Bell icon in the header that shows a dropdown with notifications.
 * Shows unread count badge and lets users mark as read or navigate to the entity.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, Trash2, AlertTriangle, Shield, FileText, TrendingDown, X, RefreshCw } from "lucide-react";
import { notificationsApi } from "@/api/endpoints";

interface Notification {
  id: string;
  type: string;
  status: string;
  title: string;
  message: string;
  data: {
    entity_id?: string;
    entity_type?: string;
    link?: string;
    severity?: string;
  } | null;
  created_at: string;
  read_at: string | null;
}

interface NotificationListResponse {
  items: Notification[];
  unread_count: number;
  total: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

function getIcon(type: string) {
  if (type.includes("vendor") || type.includes("contract")) return FileText;
  if (type.includes("risk")) return AlertTriangle;
  if (type.includes("compliance")) return TrendingDown;
  if (type.includes("audit")) return Shield;
  return Bell;
}

function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await notificationsApi.list({ limit: 20 }) as NotificationListResponse;
      setNotifications(data.items || []);
      setUnreadCount(data.unread_count || 0);
    } catch (err) {
      console.debug("Failed to load notifications:", err);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Lightweight unread-count poll — keeps the badge current without fetching the full list. */
  const pollUnreadCount = useCallback(async () => {
    try {
      const data = await notificationsApi.list({ limit: 1 }) as NotificationListResponse;
      setUnreadCount(data.unread_count || 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    loadNotifications();
    // Full refresh every 60 seconds
    const fullInterval = setInterval(loadNotifications, 60_000);
    // Unread-count badge refresh every 20 seconds (catches vendor chat messages quickly)
    const countInterval = setInterval(pollUnreadCount, 20_000);
    return () => {
      clearInterval(fullInterval);
      clearInterval(countInterval);
    };
  }, [loadNotifications, pollUnreadCount]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleMarkRead(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    try {
      await notificationsApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: "read", read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await notificationsApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, status: "read", read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  }

  async function handleDelete(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    try {
      await notificationsApi.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  async function handleCheckDeadlines() {
    try {
      setChecking(true);
      await notificationsApi.checkDeadlines();
      await loadNotifications();
    } catch (err) {
      console.error("Failed to check deadlines:", err);
    } finally {
      setChecking(false);
    }
  }

  function handleClick(notif: Notification) {
    if (notif.status === "unread") {
      handleMarkRead(notif.id);
    }
    if (notif.data?.link) {
      navigate(notif.data.link);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => { setOpen(prev => { if (!prev) { loadNotifications(); } return !prev; }); }}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-100 z-50 max-h-[70vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              <p className="text-xs text-gray-500">{unreadCount} unread</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCheckDeadlines}
                disabled={checking}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="Check deadlines now"
              >
                <RefreshCw className={`w-4 h-4 text-gray-500 ${checking ? "animate-spin" : ""}`} />
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50"
                  title="Mark all as read"
                >
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No notifications yet</p>
                <p className="text-xs text-gray-400 mt-1">Click refresh to check deadlines</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const Icon = getIcon(notif.type);
                const severity = notif.data?.severity || "info";
                const severityClass = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info;
                const isUnread = notif.status === "unread";
                return (
                  <button
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      isUnread ? "bg-blue-50/30" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${severityClass.replace("text-", "bg-").replace("-700", "-100")}`}>
                        <Icon className={`w-4 h-4 ${severityClass.split(" ")[1]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs font-semibold text-gray-900 ${isUnread ? "" : "text-gray-600"}`}>
                            {notif.title}
                          </p>
                          {isUnread && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1"></span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-gray-400">{getTimeAgo(notif.created_at)}</span>
                          <div className="flex items-center gap-1">
                            {isUnread && (
                              <button
                                onClick={(e) => handleMarkRead(notif.id, e)}
                                className="p-0.5 hover:bg-gray-100 rounded"
                                title="Mark as read"
                              >
                                <Check className="w-3 h-3 text-gray-400" />
                              </button>
                            )}
                            <button
                              onClick={(e) => handleDelete(notif.id, e)}
                              className="p-0.5 hover:bg-gray-100 rounded"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3 text-gray-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/settings?tab=notifications");
                }}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Notification settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
