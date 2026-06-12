import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  const countries = ["gb", "de", "dk", "se", "fr", "es", "it"];

  logger.info("Seeding store data...");
  const {
    result: [defaultSalesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: "Default Sales Channel",
          description: "Created by Medusa",
        },
      ],
    },
  });

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: "Default Publishable API Key",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  });

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel.id],
    },
  });

  const {
    result: [store],
  } = await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Default Store",
          supported_currencies: [
            {
              currency_code: "eur",
              is_default: true,
            },
            {
              currency_code: "usd",
              is_default: false,
            },
          ],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      ],
    },
  });

  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Europe",
          currency_code: "eur",
          countries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({
      country_code,
      provider_id: "tp_system",
    })),
  });
  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "European Warehouse",
          address: {
            city: "Copenhagen",
            country_code: "DK",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  // This is created by a migration script in core.
  const { data: shippingProfileResult } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = shippingProfileResult[0];

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "European Warehouse delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Europe",
        geo_zones: [
          {
            country_code: "gb",
            type: "country",
          },
          {
            country_code: "de",
            type: "country",
          },
          {
            country_code: "dk",
            type: "country",
          },
          {
            country_code: "se",
            type: "country",
          },
          {
            country_code: "fr",
            type: "country",
          },
          {
            country_code: "es",
            type: "country",
          },
          {
            country_code: "it",
            type: "country",
          },
        ],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ship in 2-3 days.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "eur",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ship in 24 hours.",
          code: "express",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "eur",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel.id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding product data...");

  const { result: categoryResult } = await createProductCategoriesWorkflow(
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
  });
  logger.info("Finished seeding product data.");

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryItems.map((item) => ({
        location_id: stockLocation.id,
        stocked_quantity: 1000000,
        inventory_item_id: item.id,
      })),
    },
  });

  logger.info("Finished seeding inventory levels data.");
}
