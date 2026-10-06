import {
  BadgeCheck,
  BookPlus,
  Coins,
  Inbox,
  Landmark,
  Lock,
  PackageCheck,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  Split,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { EventKind } from "@token-origins/schema";

export const EVENT_ICONS: Record<EventKind, LucideIcon> = {
  agent_registered: BadgeCheck,
  task_received: Inbox,
  search_completed: Search,
  tool_call: Wrench,
  result_evaluated: ShieldCheck,
  result_delivered: Send,
  experience_published: BookPlus,
  order_placed: ShoppingCart,
  funds_locked: Lock,
  content_delivered: PackageCheck,
  payment_collected: Landmark,
  royalty_allocated: Split,
  payout_confirmed: Coins,
};
