const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'migration-scripts', 'initial-data-seed.ts');
let content = fs.readFileSync(filePath, 'utf-8');

const newCategoriesAndProducts = `  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        { name: "Audio", is_active: true },
        { name: "Smart Home", is_active: true },
        { name: "Accessories", is_active: true },
      ],
    },
  });

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Auralis Noise-Cancelling Headphones",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Audio")!.id,
          ],
          description: "Experience silence with the Auralis Noise-Cancelling Headphones. Unmatched sound quality in a sleek, over-ear design.",
          handle: "auralis-headphones",
          weight: 500,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            { url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=1000&auto=format&fit=crop" }
          ],
          options: [{ title: "Color", values: ["Matte Black", "Silver"] }],
          variants: [
            {
              title: "Matte Black",
              sku: "AURALIS-BLK",
              options: { Color: "Matte Black" },
              prices: [{ amount: 299, currency_code: "eur" }, { amount: 349, currency_code: "usd" }]
            },
            {
              title: "Silver",
              sku: "AURALIS-SLV",
              options: { Color: "Silver" },
              prices: [{ amount: 299, currency_code: "eur" }, { amount: 349, currency_code: "usd" }]
            }
          ],
          sales_channels: [{ id: defaultSalesChannel.id }]
        },
        {
          title: "EchoBase Smart Speaker",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Smart Home")!.id,
          ],
          description: "The EchoBase brings room-filling sound and smart assistance to your living space. Voice-controlled and perfectly tuned.",
          handle: "echobase-speaker",
          weight: 1200,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            { url: "https://images.unsplash.com/photo-1543512214-318c7553f230?q=80&w=1000&auto=format&fit=crop" }
          ],
          options: [{ title: "Color", values: ["Charcoal", "Chalk"] }],
          variants: [
            {
              title: "Charcoal",
              sku: "ECHOBASE-CHAR",
              options: { Color: "Charcoal" },
              prices: [{ amount: 149, currency_code: "eur" }, { amount: 179, currency_code: "usd" }]
            },
            {
              title: "Chalk",
              sku: "ECHOBASE-CHALK",
              options: { Color: "Chalk" },
              prices: [{ amount: 149, currency_code: "eur" }, { amount: 179, currency_code: "usd" }]
            }
          ],
          sales_channels: [{ id: defaultSalesChannel.id }]
        },
        {
          title: "SonicBuds Pro Earbuds",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Audio")!.id,
          ],
          description: "True wireless earbuds with active noise cancellation and spatial audio support. Compact, comfortable, and powerful.",
          handle: "sonicbuds-pro",
          weight: 150,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            { url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?q=80&w=1000&auto=format&fit=crop" }
          ],
          options: [{ title: "Color", values: ["White"] }],
          variants: [
            {
              title: "White",
              sku: "SONICBUDS-WHT",
              options: { Color: "White" },
              prices: [{ amount: 199, currency_code: "eur" }, { amount: 249, currency_code: "usd" }]
            }
          ],
          sales_channels: [{ id: defaultSalesChannel.id }]
        },
        {
          title: "Vibe Wireless Charger",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Accessories")!.id,
          ],
          description: "Fast wireless charging pad for all Qi-enabled devices. Minimalist aluminum design.",
          handle: "vibe-charger",
          weight: 300,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            { url: "https://images.unsplash.com/photo-1586816879360-004f5b0c51e3?q=80&w=1000&auto=format&fit=crop" }
          ],
          options: [{ title: "Color", values: ["Space Gray"] }],
          variants: [
            {
              title: "Space Gray",
              sku: "VIBE-CHG-GRY",
              options: { Color: "Space Gray" },
              prices: [{ amount: 49, currency_code: "eur" }, { amount: 59, currency_code: "usd" }]
            }
          ],
          sales_channels: [{ id: defaultSalesChannel.id }]
        }
      ],
    },
  });`;

const startIndex = content.indexOf('  const { result: categoryResult } = await createProductCategoriesWorkflow(');
const endIndex = content.indexOf('  logger.info("Finished seeding product data.");');

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + newCategoriesAndProducts + '\n' + content.substring(endIndex);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log("Seed script updated successfully.");
} else {
  console.log("Could not find boundaries.");
}
