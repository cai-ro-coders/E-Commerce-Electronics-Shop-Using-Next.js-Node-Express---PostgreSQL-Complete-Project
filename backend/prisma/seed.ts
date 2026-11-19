import {
  PrismaClient, Role, OrderStatus, PaymentStatus, CouponType, InventoryType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const pick = <T,>(arr: T[], i: number) => arr[((i % arr.length) + arr.length) % arr.length];
const money = (n: number) => Number(n.toFixed(2));
const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, (n * 7) % 60, 0, 0);
  return d;
};
const daysAhead = (n: number, hour = 10) => daysAgo(-n, hour);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
const categoryImages: Record<string, string[]> = {
  laptops: [img('photo-1496181133206-80ce9b88a853'), img('photo-1517336714731-489689fd1ca8'), img('photo-1611186871348-b1ce696e52c9')],
  smartphones: [img('photo-1511707171634-5f897ff02aa9'), img('photo-1592750475338-74b7b21085ab'), img('photo-1610945265064-0e34e5519bbf')],
  audio: [img('photo-1505740420928-5e560c06d30e'), img('photo-1583394838336-acd977736f90'), img('photo-1545454675-3531b543be5d')],
  cameras: [img('photo-1516035069371-29a1b244cc32'), img('photo-1502920917128-1aa500764cbd'), img('photo-1519638831568-d9897f54ed69')],
  gaming: [img('photo-1606813907291-d86efa9b94db'), img('photo-1606144042614-b2417e99c4e3'), img('photo-1592840496694-26d035b52b48')],
  accessories: [img('photo-1527864550417-7fd91fc51a46'), img('photo-1587829741301-dc798b83add3'), img('photo-1609091839311-d5365f9ff1c5')],
  wearables: [img('photo-1523275335684-37898b6baf30'), img('photo-1546868871-7041f2a55e12'), img('photo-1579586337278-3befd40fd17a')],
  monitors: [img('photo-1527443224154-c4a3942d3acf'), img('photo-1593359677879-a4bb92f829d1'), img('photo-1547082299-de196ea013d6')],
  networking: [img('photo-1606904825846-647eb07f5be2'), img('photo-1544197150-b99a580bb7a8'), img('photo-1558494949-ef010cbdcc31')],
  storage: [img('photo-1597872200969-2b65d56bd16b'), img('photo-1531492746076-161ca9bcad58'), img('photo-1601737487795-dab272f52420')],
};

const products: Array<{
  name: string; brand: string; category: string; price: number; sale?: number; cost: number;
  stock: number; featured?: boolean; desc: string;
}> = [
  { name: 'MacBook Pro 16" M3 Pro', brand: 'Apple', category: 'laptops', price: 2499, sale: 2299, cost: 1850, stock: 18, featured: true, desc: 'A powerhouse laptop with M3 Pro chip, Liquid Retina XDR display and all-day battery life.' },
  { name: 'Dell XPS 15 OLED', brand: 'Dell', category: 'laptops', price: 1899, sale: 1749, cost: 1420, stock: 12, desc: 'Stunning 3.5K OLED display, 13th Gen Intel Core and premium aluminium chassis.' },
  { name: 'Lenovo ThinkPad X1 Carbon Gen 12', brand: 'Lenovo', category: 'laptops', price: 1699, cost: 1280, stock: 9, desc: 'Business-grade durability and featherweight carbon fibre design for professionals.' },
  { name: 'HP Spectre x360 14', brand: 'HP', category: 'laptops', price: 1499, sale: 1349, cost: 1120, stock: 15, desc: 'Convertible 2-in-1 with OLED touch display, pen support and AI-enhanced performance.' },
  { name: 'ASUS ROG Zephyrus G14', brand: 'ASUS', category: 'laptops', price: 1599, cost: 1210, stock: 7, featured: true, desc: 'Compact gaming laptop with Ryzen 9, RTX 4060 and a 120Hz Nebula display.' },
  { name: 'MacBook Air 13" M3', brand: 'Apple', category: 'laptops', price: 1099, cost: 830, stock: 25, desc: 'Thin, silent and fast. The M3 MacBook Air delivers desktop-class performance anywhere.' },
  { name: 'Microsoft Surface Laptop 6', brand: 'Microsoft', category: 'laptops', price: 1299, cost: 990, stock: 11, desc: 'PixelSense touchscreen, premium typing experience and Copilot-powered productivity.' },
  { name: 'Dell Inspiron 14 Plus', brand: 'Dell', category: 'laptops', price: 899, sale: 799, cost: 660, stock: 20, desc: 'Everyday performance with a vivid 2.2K display in a light, durable design.' },
  { name: 'iPhone 15 Pro Max', brand: 'Apple', category: 'smartphones', price: 1199, cost: 940, stock: 30, featured: true, desc: 'Titanium build, A17 Pro chip and the most capable iPhone camera system ever.' },
  { name: 'Samsung Galaxy S24 Ultra', brand: 'Samsung', category: 'smartphones', price: 1299, sale: 1149, cost: 980, stock: 22, featured: true, desc: 'Galaxy AI, a 200MP camera and built-in S Pen in a stunning titanium frame.' },
  { name: 'Google Pixel 8 Pro', brand: 'Google', category: 'smartphones', price: 999, sale: 849, cost: 720, stock: 17, desc: 'The most helpful Pixel yet with Tensor G3, Magic Editor and seven years of updates.' },
  { name: 'Samsung Galaxy Z Flip 5', brand: 'Samsung', category: 'smartphones', price: 999, cost: 780, stock: 8, desc: 'Pocketable foldable design with a flexible 6.7" display and Flex Window.' },
  { name: 'iPhone 15', brand: 'Apple', category: 'smartphones', price: 799, cost: 610, stock: 34, desc: 'Dynamic Island, USB-C and a 48MP main camera in a colourful aluminium design.' },
  { name: 'Google Pixel 8a', brand: 'Google', category: 'smartphones', price: 499, cost: 370, stock: 28, desc: 'Flagship Pixel AI features at an accessible price with a brilliant Actua display.' },
  { name: 'Samsung Galaxy A54 5G', brand: 'Samsung', category: 'smartphones', price: 449, sale: 379, cost: 290, stock: 40, desc: 'Vivid Super AMOLED display, long-lasting battery and reliable 5G performance.' },
  { name: 'Sony WH-1000XM5 Headphones', brand: 'Sony', category: 'audio', price: 399, sale: 349, cost: 265, stock: 26, featured: true, desc: 'Industry-leading noise cancellation with exceptional sound and 30-hour battery life.' },
  { name: 'Bose QuietComfort Ultra', brand: 'Bose', category: 'audio', price: 429, cost: 310, stock: 14, desc: 'Immersive spatial audio and world-class noise cancellation in a plush, lightweight fit.' },
  { name: 'Apple AirPods Pro 2 (USB-C)', brand: 'Apple', category: 'audio', price: 249, cost: 175, stock: 45, desc: 'Adaptive audio, personalised spatial sound and USB-C charging case.' },
  { name: 'Sonos Era 300 Speaker', brand: 'Sonos', category: 'audio', price: 449, cost: 330, stock: 10, desc: 'Spatial audio speaker with six drivers and room-tuning for immersive listening.' },
  { name: 'JBL Charge 5 Portable Speaker', brand: 'JBL', category: 'audio', price: 179, sale: 149, cost: 105, stock: 32, desc: 'Bold JBL Pro Sound, IP67 waterproofing and 20 hours of playtime.' },
  { name: 'Logitech G Pro X Wireless Headset', brand: 'Logitech', category: 'audio', price: 249, cost: 178, stock: 16, desc: 'Pro-grade wireless audio with Blue VO!CE microphone technology for gamers.' },
  { name: 'Canon EOS R6 Mark II', brand: 'Canon', category: 'cameras', price: 2499, cost: 1960, stock: 6, featured: true, desc: '24.2MP full-frame mirrorless camera with 40fps burst and advanced subject detection.' },
  { name: 'Sony Alpha 7 IV', brand: 'Sony', category: 'cameras', price: 2499, sale: 2299, cost: 1820, stock: 5, desc: '33MP full-frame hybrid camera delivering stunning stills and 4K 60p video.' },
  { name: 'Canon EOS R50 Creator Kit', brand: 'Canon', category: 'cameras', price: 679, sale: 599, cost: 480, stock: 18, desc: 'Compact mirrorless creator kit with 4K video, guided shooting and a versatile lens.' },
  { name: 'Sony ZV-E10 Vlogging Camera', brand: 'Sony', category: 'cameras', price: 699, cost: 520, stock: 13, desc: 'Interchangeable-lens vlogging camera with directional audio and product showcase mode.' },
  { name: 'PlayStation 5 Slim Console', brand: 'Sony', category: 'gaming', price: 499, cost: 410, stock: 20, featured: true, desc: 'Slimmer PS5 with 1TB SSD, ray tracing and the DualSense wireless controller.' },
  { name: 'Xbox Series X 1TB', brand: 'Microsoft', category: 'gaming', price: 499, cost: 420, stock: 15, desc: 'The fastest, most powerful Xbox ever with true 4K gaming and Quick Resume.' },
  { name: 'ASUS ROG Ally Handheld', brand: 'ASUS', category: 'gaming', price: 699, sale: 599, cost: 470, stock: 9, desc: 'Windows 11 gaming handheld with Ryzen Z1 Extreme and a 120Hz display.' },
  { name: 'Logitech G Pro Wireless Mouse', brand: 'Logitech', category: 'gaming', price: 149, sale: 119, cost: 82, stock: 38, desc: 'Esports-grade wireless mouse with HERO sensor and ultra-light 80g design.' },
  { name: 'Logitech MX Master 3S', brand: 'Logitech', category: 'accessories', price: 99, cost: 64, stock: 44, desc: 'Ergonomic performance mouse with quiet clicks and 8K DPI tracking.' },
  { name: 'Razer BlackWidow V4 Pro', brand: 'Razer', category: 'gaming', price: 229, cost: 155, stock: 12, desc: 'Full-size mechanical keyboard with command dial and immersive Chroma RGB.' },
  { name: 'Nintendo Switch OLED', brand: 'Nintendo', category: 'gaming', price: 349, cost: 265, stock: 24, desc: 'Vivid 7-inch OLED screen and versatile handheld, tabletop and TV play modes.' },
  { name: 'Anker 737 Power Bank 24K', brand: 'Anker', category: 'accessories', price: 149, sale: 129, cost: 88, stock: 35, desc: '24,000mAh 140W power bank with smart display for laptops, phones and tablets.' },
  { name: 'Belkin 3-in-1 Wireless Charger', brand: 'Belkin', category: 'accessories', price: 129, cost: 78, stock: 21, desc: 'Fast-charge iPhone, Apple Watch and AirPods simultaneously with MagSafe.' },
  { name: 'Apple Magic Keyboard with Touch ID', brand: 'Apple', category: 'accessories', price: 149, cost: 105, stock: 19, desc: 'Wireless keyboard with Touch ID, rechargeable battery and precise typing.' },
  { name: 'Logitech MX Keys S', brand: 'Logitech', category: 'accessories', price: 109, cost: 72, stock: 27, desc: 'Low-profile illuminated keyboard with smart backlighting and multi-device control.' },
  { name: 'Samsung T7 Shield 2TB SSD', brand: 'Samsung', category: 'storage', price: 199, sale: 169, cost: 124, stock: 22, desc: 'Rugged portable SSD with 1,050 MB/s speeds and IP65 water resistance.' },
  { name: 'SanDisk Extreme Pro 1TB SSD', brand: 'SanDisk', category: 'storage', price: 159, cost: 98, stock: 26, desc: 'Pocket-sized NVMe SSD with fast transfers and password protection.' },
  { name: 'Apple Watch Series 9', brand: 'Apple', category: 'wearables', price: 399, cost: 290, stock: 23, featured: true, desc: 'Smarter, brighter and more powerful with the S9 chip and Double Tap gesture.' },
  { name: 'Samsung Galaxy Watch 6', brand: 'Samsung', category: 'wearables', price: 299, sale: 249, cost: 180, stock: 17, desc: 'Advanced sleep coaching, body composition and a bright AMOLED display.' },
  { name: 'Garmin Venu 3', brand: 'Garmin', category: 'wearables', price: 449, cost: 320, stock: 8, desc: 'GPS smartwatch with recovery insights, sleep coach and 14-day battery life.' },
  { name: 'Google Pixel Watch 2', brand: 'Google', category: 'wearables', price: 349, cost: 252, stock: 14, desc: 'Fitbit health tracking and Google AI in a sleek, comfortable design.' },
  { name: 'Dell UltraSharp 27 4K Monitor', brand: 'Dell', category: 'monitors', price: 579, cost: 420, stock: 12, desc: '27-inch 4K IPS monitor with 99% sRGB and USB-C 90W power delivery.' },
  { name: 'LG UltraGear 27 OLED', brand: 'LG', category: 'monitors', price: 999, sale: 899, cost: 720, stock: 6, featured: true, desc: '240Hz OLED gaming monitor with 0.03ms response and stunning contrast.' },
  { name: 'Samsung Odyssey G7 32"', brand: 'Samsung', category: 'monitors', price: 699, cost: 510, stock: 10, desc: '1000R curved QHD gaming monitor with 240Hz refresh and HDR600.' },
  { name: 'TP-Link Deco XE75 Mesh (3-Pack)', brand: 'TP-Link', category: 'networking', price: 299, sale: 249, cost: 180, stock: 16, desc: 'Wi-Fi 6E whole-home mesh system covering up to 7,200 sq ft.' },
  { name: 'Netgear Nighthawk RAXE500', brand: 'Netgear', category: 'networking', price: 599, cost: 430, stock: 5, desc: 'Tri-band Wi-Fi 6E router delivering up to 10.8Gbps for power users.' },
  { name: 'ASUS ROG Rapture GT6', brand: 'ASUS', category: 'networking', price: 429, cost: 310, stock: 7, desc: 'Gaming mesh system with triple-level game acceleration and 2.5G ports.' },
  { name: 'Samsung 990 Pro 2TB NVMe', brand: 'Samsung', category: 'storage', price: 189, sale: 159, cost: 118, stock: 30, desc: 'PCIe 4.0 SSD with up to 7,450 MB/s and exceptional power efficiency.' },
  { name: 'SanDisk Extreme Portable 4TB', brand: 'SanDisk', category: 'storage', price: 309, sale: 279, cost: 212, stock: 11, desc: 'High-capacity portable SSD with IP65 durability and fast USB-C transfers.' },
];

const customerNames = [
  'Ava Thompson', 'Liam Bennett', 'Sophia Nguyen', 'Noah Martinez', 'Isabella Rossi',
  'Ethan Walker', 'Mia Patel', 'Lucas Anderson', 'Charlotte Brooks', 'Mason Rivera',
  'Amelia Cooper', 'James Kim', 'Harper Lewis', 'Benjamin Clark', 'Evelyn Turner',
  'Henry Scott', 'Abigail Hall', 'Alexander Young', 'Emily King', 'Daniel Wright',
  'Scarlett Adams', 'Michael Baker', 'Grace Nelson', 'Logan Carter', 'Chloe Mitchell',
  'Jackson Perez', 'Lily Roberts', 'Sebastian Green', 'Zoe Phillips', 'Jack Campbell',
  'Nora Parker', 'Owen Evans', 'Hannah Edwards', 'William Collins', 'Aria Stewart',
  'Matthew Sanchez', 'Ella Morris', 'Samuel Rogers', 'Avery Reed', 'David Cook',
  'Sofia Morgan', 'Joseph Bell', 'Camila Murphy', 'John Bailey', 'Penelope Rivera',
  'Luke Cooper', 'Layla Richardson', 'Gabriel Cox', 'Riley Howard', 'Isaac Ward',
];

const cities: Array<[string, string, string]> = [
  ['New York', 'NY', '10001'], ['Los Angeles', 'CA', '90001'], ['Chicago', 'IL', '60601'],
  ['Houston', 'TX', '77001'], ['Phoenix', 'AZ', '85001'], ['Seattle', 'WA', '98101'],
  ['Boston', 'MA', '02101'], ['Miami', 'FL', '33101'], ['Denver', 'CO', '80201'],
  ['Austin', 'TX', '73301'],
];

const reviewTitles = ['Excellent quality', 'Worth every penny', 'Exceeded expectations', 'Great everyday device', 'Solid performance', 'Highly recommended', 'Impressive build quality', 'A fantastic upgrade'];
const reviewComments = [
  'The build quality is outstanding and it performs exactly as advertised. Shipping was fast and the packaging was excellent.',
  'I have been using this for a few weeks and it has quickly become part of my daily routine. Battery life is impressive.',
  'Beautiful design and premium feel. Setup was simple and everything worked flawlessly out of the box.',
  'Great value for the price. The performance is smooth and the display looks fantastic.',
  'Exactly what I needed. The attention to detail is clear and it feels built to last.',
  'Works perfectly with my existing setup. I would definitely recommend it to friends and family.',
  'Customer service was helpful and delivery arrived earlier than expected. Very satisfied.',
  'A noticeable upgrade from my previous device. Fast, reliable and beautifully made.',
];

async function main() {
  const password = await bcrypt.hash('password123', 10);
  console.log('Seeding users...');

  const admin = await prisma.user.create({
    data: {
      name: 'Alexander Reid', email: 'admin@example.com', password, role: Role.admin,
      status: 'active', phone: '+1-555-0101', avatar: 'https://i.pravatar.cc/150?img=12',
      permissions: ['products.manage', 'orders.manage', 'customers.manage', 'settings.manage', 'reports.view', 'users.manage', 'inventory.manage', 'files.manage'],
      lastLoginAt: daysAgo(0, 8),
    },
  });
  const staff = await prisma.user.create({
    data: {
      name: 'Jordan Blake', email: 'staff@example.com', password, role: Role.staff,
      status: 'active', phone: '+1-555-0102', avatar: 'https://i.pravatar.cc/150?img=32',
      permissions: ['products.manage', 'orders.manage', 'inventory.manage', 'reports.view'],
      lastLoginAt: daysAgo(1, 9),
    },
  });

  const customers: Array<{ id: number; name: string; email: string }> = [];
  for (let i = 0; i < customerNames.length; i++) {
    const name = customerNames[i];
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${i + 1}@example.com`;
    const u = await prisma.user.create({
      data: {
        name, email, password, role: Role.customer,
        status: i % 11 === 9 ? 'inactive' : 'active',
        phone: `+1-555-${String(2000 + i).padStart(4, '0')}`,
        avatar: `https://i.pravatar.cc/150?img=${(i % 70) + 1}`,
        lastLoginAt: daysAgo(i % 20, 9 + (i % 8)),
      },
    });
    customers.push({ id: u.id, name: u.name, email: u.email });
  }

  for (let i = 0; i < 12; i++) {
    await prisma.loginHistory.create({
      data: {
        userId: [admin.id, staff.id, ...customers.slice(0, 10).map(c => c.id)][i],
        ip: `192.168.${i % 4}.${10 + i}`, userAgent: pick(['Chrome / macOS', 'Safari / iPhone', 'Firefox / Windows', 'Edge / Windows'], i),
        status: i % 9 === 8 ? 'failed' : 'success', createdAt: daysAgo(i, 8 + (i % 10)),
      },
    });
  }

  console.log('Seeding categories and brands...');
  const categoryData = [
    { name: 'Laptops', image: categoryImages.laptops[0], description: 'Ultrabooks, creator laptops and high-performance notebooks.' },
    { name: 'Smartphones', image: categoryImages.smartphones[0], description: 'Flagship and everyday smartphones from leading brands.' },
    { name: 'Audio', image: categoryImages.audio[0], description: 'Headphones, earbuds, speakers and studio-grade sound.' },
    { name: 'Cameras', image: categoryImages.cameras[0], description: 'Mirrorless cameras, lenses and creator kits.' },
    { name: 'Gaming', image: categoryImages.gaming[0], description: 'Consoles, handhelds, gaming peripherals and accessories.' },
    { name: 'Accessories', image: categoryImages.accessories[0], description: 'Keyboards, mice, chargers and everyday essentials.' },
    { name: 'Wearables', image: categoryImages.wearables[0], description: 'Smart watches and fitness trackers for every lifestyle.' },
    { name: 'Monitors', image: categoryImages.monitors[0], description: 'Productivity, creative and high-refresh gaming displays.' },
    { name: 'Networking', image: categoryImages.networking[0], description: 'Routers, mesh systems and networking hardware.' },
    { name: 'Storage', image: categoryImages.storage[0], description: 'Fast NVMe drives and rugged portable storage.' },
  ];
  const categoryIds: Record<string, number> = {};
  for (const c of categoryData) {
    const row = await prisma.category.create({ data: { name: c.name, slug: slugify(c.name), image: c.image, description: c.description, status: 'active' } });
    categoryIds[c.name.toLowerCase()] = row.id;
  }
  const childCategories = [
    { name: 'Gaming Laptops', parent: 'laptops' }, { name: 'Ultrabooks', parent: 'laptops' },
    { name: 'Android Phones', parent: 'smartphones' }, { name: 'iPhones', parent: 'smartphones' },
    { name: 'Headphones', parent: 'audio' }, { name: 'Speakers', parent: 'audio' },
    { name: 'Mechanical Keyboards', parent: 'accessories' }, { name: 'Smart Watches', parent: 'wearables' },
  ];
  for (const c of childCategories) {
    await prisma.category.create({ data: { name: c.name, slug: slugify(c.name), parentId: categoryIds[c.parent], status: 'active', description: `${c.name} collection.` } });
  }

  const brandData = [
    'Apple', 'Samsung', 'Dell', 'Lenovo', 'HP', 'ASUS', 'Microsoft', 'Sony', 'Google', 'Bose',
    'Canon', 'Logitech', 'JBL', 'Sonos', 'Razer', 'Nintendo', 'Anker', 'Belkin', 'SanDisk', 'Garmin',
    'LG', 'TP-Link', 'Netgear',
  ];
  const brandIds: Record<string, number> = {};
  for (const b of brandData) {
    const row = await prisma.brand.create({
      data: {
        name: b, slug: slugify(b), status: 'active',
        // Clearbit's free logo endpoint was retired; leave logos empty so the UI
        // renders its built-in monogram fallback instead of broken images.
        logo: null,
        description: `${b} official products, available with full manufacturer warranty.`,
      },
    });
    brandIds[b] = row.id;
  }

  console.log('Seeding 50 products...');
  const productRows: Array<{ id: number; name: string; sku: string; price: number; cost: number; stock: number }> = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const categoryKey = p.category;
    const images = categoryImages[categoryKey];
    const stock = [0, 3, 4, 2, 0, 6].includes(i) ? [0, 3, 4, 2, 0, 6][i] : p.stock;
    const row = await prisma.product.create({
      data: {
        name: p.name, slug: slugify(p.name), sku: `ELEC-${String(1001 + i)}`,
        categoryId: categoryIds[categoryKey], brandId: brandIds[p.brand],
        shortDescription: p.desc,
        description: `${p.desc}\n\nDesigned for people who expect more from their technology, the ${p.name} combines premium materials, thoughtful engineering and dependable performance. Every unit is inspected and backed by our 2-year limited warranty.`,
        price: p.price, salePrice: p.sale ?? null, costPrice: p.cost,
        weight: `${(0.3 + (i % 12) * 0.18).toFixed(2)} kg`,
        dimensions: `${12 + (i % 18)} x ${8 + (i % 9)} x ${2 + (i % 4)} cm`,
        stockQuantity: stock, minimumStock: 5 + (i % 4), featured: !!p.featured,
        status: i === 47 ? 'draft' : i === 48 ? 'inactive' : 'active', views: 120 + i * 37,
        images: {
          create: [
            { image: images[0], isPrimary: true, sortOrder: 0 },
            { image: images[1], isPrimary: false, sortOrder: 1 },
            { image: images[2], isPrimary: false, sortOrder: 2 },
          ],
        },
        specifications: {
          create: [
            { attributeName: 'Brand', attributeValue: p.brand },
            { attributeName: 'Model', attributeValue: `EL-${2024 + (i % 3)}-${100 + i}` },
            { attributeName: 'Warranty', attributeValue: '2 Year Limited' },
            { attributeName: 'Connectivity', attributeValue: pick(['Bluetooth 5.3', 'Wi-Fi 6E', 'USB-C', 'Wireless'], i) },
            { attributeName: 'Colour', attributeValue: pick(['Midnight Black', 'Silver', 'Graphite', 'White', 'Navy Blue'], i) },
          ],
        },
      },
    });
    productRows.push({ id: row.id, name: row.name, sku: row.sku, price: Number(row.salePrice ?? row.price), cost: Number(row.costPrice), stock });
    await prisma.inventoryLog.create({ data: { productId: row.id, type: InventoryType.stock_in, quantity: p.stock, reference: `PO-${5000 + i}`, remarks: 'Initial purchase order received', createdAt: daysAgo(60 - i) } });
    if (stock < 6) {
      await prisma.inventoryLog.create({ data: { productId: row.id, type: InventoryType.stock_out, quantity: Math.max(1, 6 - stock), reference: 'LOW-STOCK', remarks: 'Stock reserved for open orders', createdAt: daysAgo(i % 8) } });
    }
  }

  console.log('Seeding addresses and carts...');
  const addressRows: Array<{ id: number; userId: number; fullName: string; phone: string; addressLine1: string; addressLine2: string | null; city: string; province: string; postalCode: string; country: string; isDefault: boolean }> = [];
  for (let i = 0; i < customers.length; i++) {
    const [city, province, postal] = pick(cities, i);
    const a = await prisma.address.create({
      data: {
        userId: customers[i].id, fullName: customers[i].name, phone: `+1-555-${String(2000 + i).padStart(4, '0')}`,
        addressLine1: `${140 + i} ${pick(['Maple', 'Oak', 'Cedar', 'Sunset', 'Lake', 'Hill', 'Pine', 'River'], i)} ${pick(['Street', 'Avenue', 'Boulevard', 'Drive'], i)}`,
        addressLine2: i % 3 === 0 ? `Apt ${i + 4}B` : null,
        city, province, postalCode: postal, country: 'United States', isDefault: true,
      },
    });
    addressRows.push(a);
    if (i < 30) {
      const cart = await prisma.cart.create({ data: { userId: customers[i].id } });
      const p1 = pick(productRows, i * 2), p2 = pick(productRows, i * 3 + 5);
      await prisma.cartItem.create({ data: { cartId: cart.id, productId: p1.id, quantity: 1 + (i % 2), price: p1.price } });
      if (i % 3 === 0) await prisma.cartItem.create({ data: { cartId: cart.id, productId: p2.id, quantity: 1, price: p2.price } });
    }
  }

  for (let i = 0; i < 40; i++) {
    const userId = customers[i].id;
    const productId = pick(productRows, i * 5 + 1).id;
    await prisma.wishlist.create({ data: { userId, productId } }).catch(() => {});
  }

  console.log('Seeding coupons...');
  const couponDefs: Array<{ code: string; type: CouponType; value: number; min?: number; max?: number; desc: string }> = [
    { code: 'WELCOME10', type: CouponType.percentage, value: 10, min: 100, max: 100, desc: '10% off your first order' },
    { code: 'TECH20', type: CouponType.percentage, value: 20, min: 500, max: 200, desc: '20% off orders over $500' },
    { code: 'SAVE50', type: CouponType.fixed, value: 50, min: 400, desc: '$50 off orders over $400' },
    { code: 'AUDIO15', type: CouponType.percentage, value: 15, min: 150, max: 75, desc: '15% off audio products' },
    { code: 'GAMER25', type: CouponType.percentage, value: 25, min: 300, max: 150, desc: '25% off gaming gear' },
    { code: 'CAMERA100', type: CouponType.fixed, value: 100, min: 1000, desc: '$100 off camera purchases' },
    { code: 'FLASH5', type: CouponType.percentage, value: 5, max: 40, desc: 'Flash sale: 5% off everything' },
    { code: 'SUMMER30', type: CouponType.fixed, value: 30, min: 250, desc: 'Summer savings $30 off' },
    { code: 'VIP40', type: CouponType.percentage, value: 40, min: 800, max: 400, desc: 'VIP exclusive 40% off' },
    { code: 'BLACK50', type: CouponType.percentage, value: 50, min: 1000, max: 500, desc: 'Black Friday doorbuster' },
    { code: 'STUDENT10', type: CouponType.percentage, value: 10, min: 50, max: 50, desc: 'Student discount 10% off' },
    { code: 'FREESHIP', type: CouponType.fixed, value: 12.99, min: 0, desc: 'Free standard shipping' },
  ];
  const couponRows: Array<{ id: number; code: string; type: CouponType; value: number; min: number | null; max: number | null }> = [];
  for (let i = 0; i < couponDefs.length; i++) {
    const c = couponDefs[i];
    const row = await prisma.coupon.create({
      data: {
        code: c.code, type: c.type, value: c.value, description: c.desc,
        minimumOrder: c.min ?? null, maximumDiscount: c.max ?? null,
        usageLimit: 50 + i * 10, usedCount: 0, status: i === 11 ? 'inactive' : 'active',
        startDate: daysAgo(45 - i), endDate: daysAhead(45 + i * 2),
      },
    });
    couponRows.push({ id: row.id, code: row.code, type: row.type, value: Number(row.value), min: c.min ?? null, max: c.max ?? null });
  }

  console.log('Seeding 50 orders...');
  const orderStatuses: OrderStatus[] = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Delivered', 'Delivered', 'Cancelled', 'Returned'];
  const paymentStatuses: PaymentStatus[] = ['Pending', 'Paid', 'Paid', 'Paid', 'Failed', 'Refunded'];
  const carriers = ['UPS', 'FedEx', 'DHL', 'USPS'];
  const couponUseCount = new Map<number, number>();
  for (let i = 0; i < 50; i++) {
    const customer = customers[i % customers.length];
    const addr = addressRows[i % addressRows.length];
    const days = i < 5 ? 0 : i < 9 ? 1 : (i % 42) + 1;
    const createdAt = daysAgo(days, 8 + (i % 12));
    const itemCount = 1 + (i % 3);
    const chosen: Array<{ id: number; name: string; sku: string; price: number; cost: number; qty: number }> = [];
    for (let k = 0; k < itemCount; k++) {
      const p = pick(productRows, i * 3 + k * 7);
      if (chosen.some(c => c.id === p.id)) continue;
      chosen.push({ ...p, qty: 1 + ((i + k) % 3) });
    }
    const subtotal = money(chosen.reduce((s, c) => s + c.price * c.qty, 0));
    const useCoupon = i % 6 === 0;
    const coupon = couponRows[i % couponRows.length];
    let discount = 0;
    if (useCoupon && (!coupon.min || subtotal >= coupon.min)) {
      discount = coupon.type === CouponType.percentage ? money((subtotal * coupon.value) / 100) : coupon.value;
      if (coupon.max) discount = Math.min(discount, coupon.max);
      discount = Math.min(discount, subtotal);
    }
    const shippingFee = subtotal - discount >= 500 ? 0 : 12.99;
    const tax = money((subtotal - discount) * 0.08);
    const grandTotal = money(subtotal - discount + shippingFee + tax);
    let orderStatus = pick(orderStatuses, i);
    if (days === 0) orderStatus = i % 2 === 0 ? 'Pending' : 'Processing';
    if (days === 1) orderStatus = i % 2 === 0 ? 'Processing' : 'Shipped';
    let paymentStatus: PaymentStatus = orderStatus === 'Cancelled' ? 'Refunded' : orderStatus === 'Returned' ? 'Refunded' : orderStatus === 'Pending' ? pick(paymentStatuses, i) : 'Paid';
    if (i === 13) paymentStatus = 'Failed';
    if (orderStatus === 'Delivered' && paymentStatus !== 'Paid') paymentStatus = 'Paid';
    const orderNumber = `ORD-${String(10248 + i)}`;
    const order = await prisma.order.create({
      data: {
        userId: customer.id, orderNumber, subtotal, discount, shippingFee, tax, grandTotal,
        paymentMethod: pick(['stripe', 'paypal', 'cod', 'stripe'], i),
        paymentStatus, orderStatus, shippingAddressId: addr.id,
        couponCode: discount > 0 ? coupon.code : null,
        trackingNumber: ['Shipped', 'Delivered', 'Returned'].includes(orderStatus) ? `TRK${900000 + i * 37}` : null,
        carrier: ['Shipped', 'Delivered', 'Returned'].includes(orderStatus) ? pick(carriers, i) : null,
        estimatedDelivery: ['Shipped', 'Processing', 'Pending'].includes(orderStatus) ? daysAhead(2 + (i % 5)) : createdAt,
        notes: i % 7 === 0 ? 'Please leave the package at the front desk.' : i % 11 === 0 ? 'Gift wrap requested.' : null,
        createdAt, updatedAt: createdAt,
        items: {
          create: chosen.map(c => ({ productId: c.id, productName: c.name, sku: c.sku, quantity: c.qty, price: c.price, total: money(c.price * c.qty) })),
        },
        payment: {
          create: {
            transactionId: `TXN-${String(50000 + i * 13)}`,
            paymentGateway: pick(['stripe', 'paypal'], i),
            amount: grandTotal, currency: 'USD', status: paymentStatus,
            paidAt: paymentStatus === 'Paid' ? createdAt : null, createdAt, updatedAt: createdAt,
          },
        },
      },
    });

    const flow: OrderStatus[] = ['Pending', 'Processing', 'Shipped', 'Delivered'];
    const limit = orderStatus === 'Cancelled' || orderStatus === 'Returned' ? 2 : flow.indexOf(orderStatus) + 1;
    for (let s = 0; s < limit; s++) {
      await prisma.orderStatusHistory.create({
        data: { orderId: order.id, status: flow[s], note: s === 0 ? 'Order placed by customer' : `Status updated to ${flow[s]}`, createdAt: new Date(createdAt.getTime() + s * 86400000 / 2) },
      });
    }
    if (orderStatus === 'Cancelled' || orderStatus === 'Returned') {
      await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: orderStatus, note: 'Order closed by administrator', createdAt: new Date(createdAt.getTime() + 2 * 86400000) } });
    }

    if (discount > 0) {
      await prisma.couponUsage.create({ data: { couponId: coupon.id, userId: customer.id, orderId: order.id, discountAmount: discount, createdAt } });
      couponUseCount.set(coupon.id, (couponUseCount.get(coupon.id) ?? 0) + 1);
    }

    for (const item of chosen) {
      if (['Pending', 'Processing', 'Shipped', 'Delivered'].includes(orderStatus)) {
        await prisma.inventoryLog.create({
          data: { productId: item.id, type: InventoryType.stock_out, quantity: item.qty, reference: orderNumber, remarks: `Sold via order ${orderNumber}`, createdAt },
        });
      }
    }

    await prisma.notification.create({
      data: {
        userId: admin.id, title: 'New order received', message: `${orderNumber} from ${customer.name} — $${grandTotal.toFixed(2)}`,
        type: 'order', link: `/admin/orders/${order.id}`, isRead: i > 10, createdAt,
      },
    });
  }

  for (const [couponId, count] of couponUseCount) {
    await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: count } });
  }

  console.log('Seeding reviews...');
  for (let i = 0; i < 60; i++) {
    const product = pick(productRows, i * 2 + 3);
    const customer = customers[(i * 3) % customers.length];
    await prisma.review.create({
      data: {
        productId: product.id, userId: customer.id, rating: i % 9 === 0 ? 2 : 3 + (i % 3),
        title: pick(reviewTitles, i), comment: pick(reviewComments, i * 2),
        status: i % 8 === 0 ? 'pending' : i % 15 === 7 ? 'rejected' : 'approved',
        createdAt: daysAgo(i % 40, 12), updatedAt: daysAgo(i % 40, 12),
      },
    });
  }

  console.log('Seeding inventory events and notifications...');
  const eventTypes = ['restock', 'stocktake', 'supplier', 'promotion', 'audit'];
  for (let i = 0; i < 50; i++) {
    const forward = i % 3 !== 0;
    const product = pick(productRows, i * 3);
    const type = pick(eventTypes, i);
    await prisma.inventoryEvent.create({
      data: {
        title: type === 'restock' ? `Restock: ${product.name.slice(0, 34)}` : type === 'stocktake' ? 'Monthly cycle count' : type === 'supplier' ? 'Supplier delivery window' : type === 'promotion' ? 'Warehouse promotion prep' : 'Inventory audit',
        start: forward ? daysAhead(i % 40, 9) : daysAgo(i % 25, 14),
        end: forward ? daysAhead(i % 40, 17) : daysAgo(i % 25, 17),
        type, productId: product.id,
        notes: type === 'restock' ? 'Confirm receiving quantities against purchase order.' : 'Coordinate with warehouse operations team.',
      },
    });
  }

  const notifTypes = ['order', 'stock', 'review', 'payment', 'system', 'customer'];
  for (let i = 0; i < 50; i++) {
    const target = i % 5 === 0 ? null : i % 4 === 0 ? staff.id : admin.id;
    const type = pick(notifTypes, i);
    await prisma.notification.create({
      data: {
        userId: target,
        title: type === 'stock' ? 'Low stock warning' : type === 'review' ? 'New review awaiting moderation' : type === 'payment' ? 'Payment received' : type === 'customer' ? 'New customer registered' : type === 'order' ? 'Order status updated' : 'Scheduled maintenance',
        message: type === 'stock' ? `${pick(productRows, i * 3).name} is at or below its minimum stock level.` : type === 'review' ? `A new ${3 + (i % 3)}-star review needs approval.` : type === 'payment' ? `Payment of $${(120 + i * 17).toFixed(2)} confirmed.` : type === 'customer' ? `${pick(customers, i).name} created an account.` : type === 'order' ? `Order ORD-${10248 + i} moved to the next fulfilment stage.` : 'System health check completed successfully.',
        link: type === 'order' ? `/admin/orders` : type === 'stock' ? `/admin/inventory` : type === 'review' ? `/admin/reviews` : null,
        isRead: i > 8, createdAt: daysAgo(i % 15, 7 + (i % 12)),
      },
    });
  }

  console.log('Seeding activity logs and files...');
  const actions = [
    ['product.updated', 'Product', 'Updated pricing and stock levels'],
    ['order.status_changed', 'Order', 'Changed fulfilment status'],
    ['customer.created', 'Customer', 'Created a new customer account'],
    ['coupon.created', 'Coupon', 'Created a promotional coupon'],
    ['settings.updated', 'Setting', 'Updated store configuration'],
    ['inventory.adjusted', 'Inventory', 'Adjusted stock quantity'],
    ['review.approved', 'Review', 'Approved a product review'],
    ['user.login', 'Session', 'Signed in to the admin console'],
  ];
  for (let i = 0; i < 50; i++) {
    const a = pick(actions, i);
    await prisma.activityLog.create({
      data: { userId: i % 4 === 0 ? staff.id : admin.id, action: a[0], entity: a[1], entityId: 1 + (i % 50), details: a[2], ip: `192.168.1.${20 + (i % 30)}`, createdAt: daysAgo(i % 20, 8 + (i % 10)) },
    });
  }

  const folders = ['images', 'documents', 'invoices', 'contracts', 'customer-files'];
  const fileNames = ['product-launch-brief', 'q4-supplier-contract', 'invoice-batch-a', 'warehouse-photo', 'customer-verification', 'brand-guidelines', 'shipping-manifest', 'tax-document', 'campaign-assets', 'warranty-policy'];
  for (let i = 0; i < 50; i++) {
    const folder = pick(folders, i);
    const isImage = folder === 'images' || folder === 'customer-files' || i % 3 === 0;
    const name = `${pick(fileNames, i)}-${i + 1}.${isImage ? 'jpg' : 'pdf'}`;
    await prisma.fileAsset.create({
      data: {
        name, folder,
        path: isImage ? categoryImages[pick(Object.keys(categoryImages), i)][i % 3] : 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        mime: isImage ? 'image/jpeg' : 'application/pdf', size: 120000 + i * 9300,
        uploadedById: i % 3 === 0 ? staff.id : admin.id, createdAt: daysAgo(i % 35, 10),
      },
    });
  }

  console.log('Seeding settings and contact messages...');
  const settings: Array<[string, string, string]> = [
    ['site_name', 'general', 'ElectroShop'],
    ['site_tagline', 'general', 'Premium Electronics. Engineered for Life.'],
    ['site_logo', 'general', ''],
    ['support_email', 'general', 'support@electroshop.com'],
    ['support_phone', 'general', '+1 (555) 010-0199'],
    ['currency', 'general', 'USD'],
    ['tax_rate', 'general', '8'],
    ['shipping_fee', 'general', '12.99'],
    ['free_shipping_threshold', 'general', '500'],
    ['company_name', 'company', 'ElectroShop Inc.'],
    ['company_address', 'company', '488 Madison Avenue, New York, NY 10022'],
    ['company_phone', 'company', '+1 (555) 010-0199'],
    ['company_email', 'company', 'hello@electroshop.com'],
    ['smtp_host', 'smtp', 'smtp.mailgun.org'],
    ['smtp_port', 'smtp', '587'],
    ['smtp_username', 'smtp', 'postmaster@electroshop.com'],
    ['smtp_password', 'smtp', '••••••••'],
    ['smtp_from_name', 'smtp', 'ElectroShop'],
    ['smtp_from_email', 'smtp', 'orders@electroshop.com'],
    ['stripe_publishable_key', 'payment', ''],
    ['stripe_secret_key', 'payment', ''],
    ['paypal_client_id', 'payment', ''],
    ['paypal_client_secret', 'payment', ''],
    ['paypal_mode', 'payment', 'sandbox'],
    ['cod_enabled', 'payment', 'true'],
    ['language', 'locale', 'en'],
    ['timezone', 'locale', 'America/New_York'],
    ['date_format', 'locale', 'MMM DD, YYYY'],
    ['theme', 'appearance', 'light'],
    ['accent_color', 'appearance', '#2563eb'],
    ['enable_dark_mode', 'appearance', 'true'],
    ['maintenance_mode', 'appearance', 'false'],
  ];
  for (const [key, group, value] of settings) {
    await prisma.setting.create({ data: { key, group, value } });
  }

  const contactMessages = [
    ['Olivia Grant', 'olivia.grant@example.com', 'Order delivery question', 'Hi, my order was marked delivered but I have not received the package. Can you check with the carrier?'],
    ['Marcus Lee', 'marcus.lee@example.com', 'Bulk purchase enquiry', 'We are looking to equip our studio with 12 monitors. Do you offer business pricing and net terms?'],
    ['Priya Shah', 'priya.shah@example.com', 'Warranty claim', 'My headphones developed a fault in the left ear cup after two months. What is the warranty process?'],
    ['Daniel Ortiz', 'daniel.ortiz@example.com', 'Product availability', 'Is the LG UltraGear 27 OLED expected back in stock soon? I would like to backorder one.'],
    ['Emma Wilson', 'emma.wilson@example.com', 'Return request', 'I ordered the wrong laptop model. Can I exchange it for the 16-inch MacBook Pro?'],
    ['Liam Turner', 'liam.turner@example.com', 'Payment issue', 'My card was charged twice for order ORD-10271. Please help me resolve this.'],
    ['Sofia Alvarez', 'sofia.alvarez@example.com', 'Partnership opportunity', 'We run a corporate IT procurement firm and would like to discuss a partnership.'],
    ['Noah Kim', 'noah.kim@example.com', 'Shipping address change', 'Can I update the delivery address for my order before it ships?'],
    ['Ava Brooks', 'ava.brooks@example.com', 'Product recommendation', 'I need a lightweight laptop for travel and photo editing under $1,500. What do you suggest?'],
    ['Ethan Hall', 'ethan.hall@example.com', 'Invoice request', 'Please send a VAT invoice for my recent purchase for company reimbursement.'],
    ['Mia Chen', 'mia.chen@example.com', 'Store hours', 'Are you open on weekends for in-store pickup?'],
    ['Lucas Meyer', 'lucas.meyer@example.com', 'Coupon not working', 'The TECH20 coupon says invalid even though my cart is above $500.'],
    ['Harper Diaz', 'harper.diaz@example.com', 'Review removal', 'I would like to update a review I left last week. How can I edit it?'],
    ['Jack Foster', 'jack.foster@example.com', 'Wholesale pricing', 'Do you offer wholesale pricing for schools and universities?'],
    ['Chloe Patel', 'chloe.patel@example.com', 'Excellent service', 'Just wanted to say thank you — my order arrived a day early and the packaging was perfect.'],
  ];
  for (let i = 0; i < contactMessages.length; i++) {
    const [name, email, subject, message] = contactMessages[i];
    await prisma.contactMessage.create({
      data: { name, email, subject, message, status: i < 4 ? 'new' : i < 10 ? 'read' : 'replied', createdAt: daysAgo(i, 10 + (i % 8)) },
    });
  }

  console.log('Seed completed successfully.');
  console.log(`  ${customers.length + 2} users, ${products.length} products, 50 orders, 60 reviews, 50 notifications, 50 files`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
