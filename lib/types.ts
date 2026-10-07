// Five roles (lib/roles.ts has the names people see): admin = Super admin
// (the group owners), manager, hr, employee = Front House
// (till only), kitchen (Kitchen Display only).
export type StaffRole = "employee" | "kitchen" | "manager" | "hr" | "admin";

export interface Staff {
  id: number;
  name: string;
  business_id: number | null;
  is_owner: boolean;
  pin_hash: string | null;
  username: string | null;
  password_hash: string | null;
  role: StaffRole;
  /** Can be given deliveries (sees My deliveries on their phone). */
  can_deliver?: boolean;
  active: number;
  employee_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  date_of_birth: string | null;
  hire_date: string | null;
  employment_type: "hourly" | "salaried";
  pay_rate: number;
  pay_frequency: "weekly" | "monthly";
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: string;
  /** Assigned locations (staff_locations); empty = unassigned (no location access). Included by the employee APIs. */
  location_ids?: number[];
}

export interface Shift {
  id: number;
  staff_id: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  position: string | null;
  status: "scheduled" | "completed" | "missed" | "cancelled";
  notes: string | null;
  created_by: number | null;
  created_at: string;
  staff_name?: string;
}

export interface ClockEvent {
  id: number;
  staff_id: number;
  shift_id: number | null;
  clock_in: string;
  clock_out: string | null;
  status: "open" | "closed";
  late_minutes: number;
  notes: string | null;
  correction_status: "none" | "pending" | "approved" | "rejected";
  correction_reason: string | null;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  approved_by: number | null;
  approved_at: string | null;
  clock_in_latitude?: number | null;
  clock_in_longitude?: number | null;
  clock_in_distance_m?: number | null;
  clock_out_latitude?: number | null;
  clock_out_longitude?: number | null;
  clock_out_distance_m?: number | null;
  clocked_in_by_manager?: number | null;
  created_at: string;
  staff_name?: string;
}

export interface LeaveRequest {
  id: number;
  staff_id: number;
  leave_type: "holiday" | "sick" | "unpaid" | "other";
  start_date: string;
  end_date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
  staff_name?: string;
}

export interface PayrollPeriod {
  id: number;
  period_start: string;
  period_end: string;
  status: "open" | "processing" | "closed";
  created_at: string;
}

export interface PayrollEntry {
  id: number;
  payroll_period_id: number;
  staff_id: number;
  hours_worked: number;
  pay_rate: number;
  base_pay: number;
  bonuses: number;
  tips: number;
  deductions: number;
  holiday_pay: number;
  gross_pay: number;
  paid_amount: number;
  status: "pending" | "partially_paid" | "paid";
  notes: string | null;
  created_at: string;
  updated_at: string;
  staff_name?: string;
}

export interface MenuCategory {
  id: number;
  name: string;
  display_order: number;
  color: string;
  active: number;
}

export interface ModifierOption {
  id: number;
  name: string;
  price_delta: number;
}

export interface ModifierGroup {
  id: number;
  name: string;
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number | null;
  required: boolean;
  options: ModifierOption[];
}

export interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  price: number; // collection / till price
  online_price?: number | null; // delivery price (null = same as price) — see PriceType in lib/menu.ts
  sold_out_until?: string | null; // marked sold out at the till until then (lib/sold-out.ts)
  is_veg: number;
  active: number;
  display_order: number;
  category_name?: string;
  category_color?: string;
  available_dine_in?: boolean;
  available_takeaway?: boolean;
  available_delivery?: boolean;
  available_online?: boolean;
  modifierGroups?: ModifierGroup[];
}

export interface RestaurantTable {
  id: number;
  table_number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved";
  location: "main" | "outdoor" | "private";
  occupied_since?: string | null; // created_at of the table's oldest active order, if any
  self_order_enabled: boolean; // staff-controlled: gates public QR ordering for this table
  // Floor plan (Staff Hub → Tables, lib/floor-plan.ts): top-left cell and shape.
  pos_x?: number | null;
  pos_y?: number | null;
  shape?: "square" | "round" | "rect" | null;
  rotation?: number | null; // degrees, 45° steps
  // Joined tables (migration 112): an extra table points at its group's lead;
  // the lead carries the optional group name and the "T1 + T2" label.
  joined_to?: number | null;
  group_name?: string | null;
  join_label?: string | null;
}

export interface WorkPeriod {
  id: number;
  opened_by: number;
  closed_by: number | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  status: "open" | "closed";
}

export interface Order {
  id: number;
  order_number: string;
  order_type: "dine_in" | "takeaway" | "delivery";
  table_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status: "open" | "sent_to_kitchen" | "ready" | "paid" | "cancelled";
  staff_id: number;
  work_period_id: number | null;
  subtotal: number;
  discount: number;
  discount_reason: string | null;
  /** Loyalty reward (voucher or points) — its own line, on top of any discount. */
  loyalty_discount?: number;
  loyalty_reason?: string | null;
  loyalty_given_by?: string | null;
  tax: number;
  total: number;
  notes: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  table_number?: string;
  staff_name?: string;
  // Kitchen-display-only flags (set by /api/kitchen)
  is_modification?: boolean;
  // Round number within the table's current visit (lib/kitchen-rounds.ts).
  round?: number | null;
  just_cancelled?: boolean;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number | null;
  item_name: string;
  item_price: number;
  quantity: number;
  original_quantity: number | null;
  notes: string | null;
  status: "pending" | "preparing" | "ready" | "cancelled";
  created_at: string;
  modifiers?: string[];
}

export interface Payment {
  id: number;
  order_id: number;
  method: "cash" | "card";
  amount: number;
  change_given: number;
  reference: string | null;
  staff_id: number;
  created_at: string;
}

export interface SessionUser {
  id: number;
  name: string;
  role: StaffRole;
  /** The business this login is working for (lib/business.ts). */
  businessId: number;
  /** The group owner: can switch into any business (lib/business.ts). */
  owner?: boolean;
  /** Front House / Kitchen with "Can deliver", signed in on their phone:
   *  they only see My deliveries in the Staff Hub. */
  deliver?: boolean;
}

export interface CartItem {
  menu_item_id: number;
  item_name: string;
  item_price: number; // base price + sum of selected modifier deltas
  quantity: number;
  notes?: string;
  is_veg?: number;
  sent?: boolean;     // true = already in kitchen (locked)
  db_id?: number;     // order_items.id for sent items
  order_id?: number;  // which order this item belongs to
  voided?: boolean;   // struck through, excluded from total
  selected_modifiers?: ModifierOption[];
}

export interface CategoryWithItems extends MenuCategory {
  items: MenuItem[];
}

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: number;
  created_at: string;
}

export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  current_stock: number;
  reorder_level: number;
  reorder_quantity: number;
  cost_per_unit: number;
  supplier_id: number | null;
  active: number;
  created_at: string;
  supplier_name?: string;
}

export interface PurchaseOrder {
  id: number;
  order_number: string;
  supplier_id: number;
  status: "draft" | "ordered" | "received" | "cancelled";
  order_date: string;
  expected_date: string | null;
  received_date: string | null;
  total_cost: number;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  supplier_name?: string;
}

export interface PurchaseOrderItem {
  id: number;
  purchase_order_id: number;
  ingredient_id: number;
  quantity: number;
  unit_cost: number;
  received_quantity: number | null;
  expiry_date: string | null;
  ingredient_name?: string;
  unit?: string;
}

export interface StockMovement {
  id: number;
  ingredient_id: number;
  movement_type: "purchase" | "waste" | "adjustment" | "usage";
  quantity_delta: number;
  reference_type: string | null;
  reference_id: number | null;
  reason: string | null;
  staff_id: number | null;
  created_at: string;
  ingredient_name?: string;
  staff_name?: string;
}

export interface Recipe {
  id: number;
  menu_item_id: number | null;
  name: string;
  yield_quantity: number;
  yield_unit: string;
  notes: string | null;
  active: number;
  created_at: string;
  menu_item_name?: string;
  menu_item_price?: number;
}

export interface ModifierOption {
  id: number;
  group_id: number;
  name: string;
  price_delta: number;
  display_order: number;
}

export interface ModifierGroup {
  id: number;
  name: string;
  selection_type: "single" | "multiple";
  min_select: number;
  max_select: number | null;
  created_at: string;
  options: ModifierOption[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null; // null for an account created by email signup with no phone on file yet
  email: string | null;
  date_of_birth: string | null;
  address: string | null;
  notes: string | null;
  loyalty_points: number;
  referral_code: string | null;
  referred_by_customer_id: number | null;
  marketing_consent: boolean;
  created_at: string;
  // password_hash intentionally omitted — never select it into a shape that
  // could reach client code (see lib/customers.ts:CUSTOMER_SAFE_FIELDS).
}

export interface CustomerSession {
  id: number;
  name: string;
  email: string;
}

export interface LoyaltyTransaction {
  id: number;
  customer_id: number;
  points_delta: number;
  reason: "earned_purchase" | "redeemed_reward" | "birthday_bonus" | "referral_bonus" | "manual_adjustment";
  reference_type: string | null;
  reference_id: number | null;
  staff_id: number | null;
  created_at: string;
}

export interface LoyaltyReward {
  id: number;
  name: string;
  description: string | null;
  points_cost: number;
  active: number;
  created_at: string;
}

export interface RecipeIngredient {
  id: number;
  recipe_id: number;
  ingredient_id: number;
  quantity: number;
  notes: string | null;
  ingredient_name?: string;
  unit?: string;
  cost_per_unit?: number;
}
