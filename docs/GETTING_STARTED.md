# Getting Started with Royal Chilli POS

This guide walks you through the system on your first day and explains how to use it day-to-day.

---

## **First Day Checklist**

### **1. Sign In**
Go to **https://www.theroyalchilli.com/login** (or your domain). Sign in with your email and password.

You land on one of three pages depending on your role:
- **Manager / HR / Admin:** Staff Hub (the dashboard with menus)
- **Driver:** "My Deliveries" page (orders assigned to you)
- **Employee / Kitchen / Bar:** POS (till screen for taking orders)

### **2. Find Your Role**
Ask your manager or admin which role you have. Roles control what you can see and do:

| Role | Can see | Use case |
|------|---------|----------|
| **Manager** | Menu, Tables, Inventory, Drivers, Staff, Reports, Analytics | Day-to-day operations |
| **Admin** | Everything a manager sees + Roles & Permissions, Settings | Business configuration |
| **Owner** | Everything + manage other businesses in your group | Multi-location oversight |
| **Driver** | Only "My Deliveries" | Manage your delivery orders |
| **Employee** | POS only (till screen) | Take orders, manage tables |
| **Kitchen** | POS only (kitchen prep screen) | See orders to prepare |
| **Bar** | POS only (bar prep screen) | See drink orders |

### **3. Check Your Business**
In Staff Hub, look at the top-left corner. You should see your restaurant name and logo. If you see a different business, click the name to switch (owner only).

### **4. Explore the Menu**
Staff Hub has 4 main sections:

```
📍 Dashboard (home)
├─ 🎯 Operations
│  ├─ Menu
│  ├─ Tables
│  ├─ Inventory
│  ├─ Drivers
│  ├─ Delivery platforms
│  ├─ Till
│  └─ 🌐 Website ← Manage what customers see online
├─ 👥 People
│  ├─ Attendance & Rota
│  ├─ HR & Payroll
│  └─ Customers & Loyalty
├─ 📊 Insights
│  ├─ Analytics
│  ├─ Reports
│  ├─ Finance
│  └─ Audit log
└─ ⚙️ Settings
   └─ Business setup, Roles & Permissions, Businesses (owner only)
```

---

## **Day-to-Day Workflows**

### **🍽️ Taking Orders (POS)**

**Where:** Click **Till** in Operations

**What you see:**
- Your menu on the left (organized by category)
- Order breakdown on the right
- Table, takeaway, or delivery order type at the top

**How to take an order:**
1. Select the order type: **Table**, **Takeaway**, or **Delivery**
2. If **Table:** pick the table number
3. If **Delivery:** enter the customer's address (or pick a saved address)
4. Tap menu items to add them to the order
5. Adjust quantities or special requests
6. Add discount or notes if needed
7. Tap **Submit Order**
8. Choose payment method: **Card** (pinpad), **Cash**, **Later**

**Order moves to:**
- **Kitchen screen** (for prep)
- **Delivery drivers** (if delivery, marked "unassigned" until a driver picks it up)
- **Customer receipt** (if online order)

### **📦 Managing Inventory**

**Where:** Click **Inventory** in Operations

**View levels:**
- See stock counts for all ingredients
- Filter by category or location
- Red flags show low stock

**Record a stock movement (e.g., you receive new stock):**
1. Click the ingredient
2. Enter the new count
3. Add notes (e.g., "Delivery from supplier X")
4. Save

**Do a stock take (full recount):**
1. Click **Stock take** at the top
2. Walk around with the tablet and count everything
3. Tap each ingredient and enter the actual count
4. When done, click **Finalize**

### **🚗 Managing Drivers & Deliveries**

**Where:** Click **Drivers** in Operations

**You see two views:**

**Managers/Admins see:**
- **Roster:** all drivers, their status (available, on delivery, offline), and stats (delivered today, total value)
- **Assignments:** unassigned delivery orders; drag a driver's card onto an order to assign it

**Drivers see:**
- Only **"My Deliveries"**: their assigned orders with customer address and phone
- Status buttons: "Available" → "Start Delivery" → "Mark Delivered"

**Typical flow:**
1. Customer order comes in as "Delivery"
2. Manager/admin sees it in Assignments as "Unassigned"
3. Manager clicks an available driver and assigns the order
4. Driver sees it in their "My Deliveries" list
5. Driver clicks "Start Delivery" when leaving
6. Driver clicks "Mark Delivered" at customer's door
7. Order is marked "Paid" (for cash-on-delivery)

### **📱 Website Management**

**Where:** Click **🌐 Website** in Operations

**What's on this page:**

1. **Your website card** (read-only)
   - Domain, logo, tagline, phone, email, online ordering status
   - Edit these in **Settings → Business setup**

2. **Online ordering**
   - Toggle "Take orders on the website" (owner-only)
   - Show "coming soon" while it's off
   - See what's connected (website orders, QR tables, drivers, delivery platforms)

3. **Homepage content** (what customers see)
   - Opening hours
   - Special promotion / banner (e.g., "20% off collection every Monday")
   - About line (falls back to your tagline if blank)
   - Show/hide the gallery

4. **SEO & social media** (help customers find you)
   - Page title and meta description (shown in Google search)
   - Google search preview (mock-up of how it looks)
   - Social-sharing image (shown when shared on WhatsApp, Facebook, etc.)
   - Instagram, Facebook, WhatsApp links

5. **Website traffic** (coming soon)
   - Will show visitors, top pages, conversion rate
   - Link a Google Analytics property in **Settings → Business setup**

**Typical task:** Manager gets a call saying "We're closed tomorrow for staff training"
- Go to Website → Homepage content → edit opening hours
- Click Save
- ✓ Saved

### **👥 Managing Staff**

**Where:** Click **Attendance & Rota** in People

This is an external system (SSO) for clocking in/out, requesting leave, and viewing rotas. Your manager or HR will set you up there.

**Within the POS itself, Staff appears under:**
- **Settings → Roles & Permissions** (admins only): create staff, assign roles, manage permissions

### **💰 Checking Finance & Reports**

**Where:** Click **Finance** or **Reports** in Insights

**Finance** shows:
- Daily totals (revenue, refunds, cash vs card)
- Costs (food, labour, rent)
- Profit / loss

**Reports** shows:
- Sales by time period
- Top items
- Customer counts
- Delivery stats

---

## **Common Scenarios**

### **Scenario 1: A Driver Hasn't Picked Up an Order**

**Problem:** An order's been "unassigned" for 20 minutes

**Fix:**
1. Go to **Operations → Drivers**
2. In **Assignments**, see which drivers are "available" or "offline"
3. Tap an available driver and drag onto the stuck order
4. Driver gets notified

### **Scenario 2: You Run Out of an Ingredient Mid-Service**

**Problem:** Kitchen says "no more chicken biryani"

**Fix:**
1. Go to **Operations → Menu**
2. Find "Chicken Biryani"
3. Click the 3-dot menu and select **Hide** (or **Out of stock**)
4. ✓ Now customers can't order it; kitchen won't see new orders for it
5. When stock arrives, **Unhide** it

**Alternative:** Go to **Inventory** → find the ingredient → set to 0

### **Scenario 3: Customer Calls: "Where's My Delivery?"**

**Fix:**
1. Go to **Operations → Drivers**
2. Look in **Assignments** for the order (by number or customer name)
3. Click the order to see:
   - Assigned driver's name & phone
   - Current status ("Assigned", "Out for delivery", "Delivered")
4. Call the driver or reassign to someone else if stuck

### **Scenario 4: You Want to See Yesterday's Sales**

**Fix:**
1. Go to **Insights → Reports** (or **Finance**)
2. Select the date range
3. ✓ See revenue, top items, customer count, etc.

### **Scenario 5: You Hired a New Manager and Need to Give Them Access**

**Fix** (Admin only):
1. Go to **Settings → Roles & Permissions**
2. Click **Add staff** and fill in their details
3. Assign role: **Manager**
4. Set permissions: check the boxes for what they can see (Menu, Inventory, Reports, etc.)
5. Save
6. They receive an email with a link to set their password

---

## **Settings & Configuration**

### **Settings Page** (Admin only)

**Path:** Staff Hub → ⚙️ Settings

**Tabs:**

#### **General**
- Change your password
- Configure notifications (email alerts for low stock, new orders, etc.)

#### **Business setup**
- Business name, logo, tagline, brand color
- Phone, email, address
- Opening hours (what customers see)
- Modules toggle (online ordering, QR tables, delivery, etc.)
- Payment methods (Stripe keys, card reader config)

#### **Roles & Permissions**
- Create or edit staff roles
- Assign permissions (who can see Menu, Inventory, Reports, etc.)
- View audit log (who did what, when)

#### **Businesses** (Owner only)
- Manage all restaurants in your group
- Switch between them
- Add a new location

---

## **Tips & Best Practices**

### **Daily**
- ✅ Check **Dashboard** for alerts (low stock, pending orders, etc.)
- ✅ Check **Drivers** in the morning — make sure drivers are available
- ✅ Check **Website** if it's a special offer day (update the promo banner)

### **Weekly**
- ✅ Do a **stock take** (Inventory → Stock take) on a quiet shift
- ✅ Check **Reports** — see trends, top items, busy times
- ✅ Check **Attendance & Rota** — confirm next week's staff are scheduled

### **Monthly**
- ✅ Review **Finance** — compare this month to last
- ✅ Review **Analytics** — website traffic, customer trends
- ✅ Check **Audit log** — see what changed (who, when)

### **When Updates Come**
- A new feature gets added to the menu or homepage
- An admin pushes a code update to the server
- You might see a "New!" badge in the Staff Hub
- Refresh your browser if something looks broken

---

## **Troubleshooting**

### **"I'm locked out / forgot my password"**

Go to **https://www.theroyalchilli.com/login** and click **"Forgot password?"**. Check your email for a reset link.

If you don't receive it, ask your admin to reset it for you under **Settings → Roles & Permissions**.

### **"An order isn't showing up"**

1. Is it very recent? It may still be in the kitchen. Refresh the page.
2. Is it cancelled? Check **Insights → Audit log** — search for the order number.
3. Is it a delivery? Go to **Drivers → Assignments** — it might be there.

### **"The POS is slow / buttons aren't responding"**

- Close and reopen your browser tab
- If using a tablet, restart it
- Check your internet connection (wifi or mobile data)
- If it keeps happening, contact your admin

### **"I made a mistake on an order — can I cancel it?"**

1. If the order hasn't gone to the kitchen yet: **POS → click the order → cancel**
2. If it's already in the kitchen: ask the kitchen to stop, or call the customer

Cancellations are logged in the **Audit log**, so admins can see what happened.

### **"A driver didn't deliver an order — what do we do?"**

1. Go to **Drivers → Assignments** and find the order
2. Mark it as "Failed" or reassign to another driver
3. Contact the customer to redeliver or refund
4. Log the issue in the **Audit log** notes for future reference

---

## **What's Coming Next**

The roadmap includes:

- **Menu & photos** — upload dish photos and manage what appears on the website
- **Website analytics** — see how many people visit your website and place orders
- **Loyalty program** — reward repeat customers
- **Advanced reporting** — P&L by location, staff performance, etc.

---

## **Need Help?**

- **Technical issue?** Contact your admin or IT team
- **Feature request?** Talk to your manager
- **How do I...?** Check the **Audit log** to see how someone else did it, or ask a colleague

Good luck! 🍽️
