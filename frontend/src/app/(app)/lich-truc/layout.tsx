import type { ReactNode } from "react";

/** Khu vực Lịch khám dùng bảng màu riêng (xem .duty-theme trong globals.css) */
export default function DutyLayout({ children }: { children: ReactNode }) {
  return <div className="duty-theme">{children}</div>;
}
