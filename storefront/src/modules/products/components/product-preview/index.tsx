import { Text } from "@medusajs/ui"
import { listProducts } from "@lib/data/products"
import { getProductPrice } from "@lib/util/get-product-price"
import { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import Thumbnail from "../thumbnail"
import PreviewPrice from "./price"

export default async function ProductPreview({
  product,
  isFeatured,
  region,
}: {
  product: HttpTypes.StoreProduct
  isFeatured?: boolean
  region: HttpTypes.StoreRegion
}) {
  // const pricedProduct = await listProducts({
  //   regionId: region.id,
  //   queryParams: { id: [product.id!] },
  // }).then(({ response }) => response.products[0])

  // if (!pricedProduct) {
  //   return null
  // }

  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
    <LocalizedClientLink href={`/products/${product.handle}`} className="group">
      <div data-testid="product-wrapper" className="bg-brand-cream border-[3px] border-brand-brown rounded-[2rem] p-4 flex flex-col gap-4 shadow-[4px_4px_0_#6b3e28] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#6b3e28] transition-all duration-200">
        <Thumbnail
          thumbnail={product.thumbnail}
          images={product.images}
          size="full"
          isFeatured={isFeatured}
          className="rounded-[1rem] border-[3px] border-brand-brown overflow-hidden bg-white"
        />
        <div className="flex txt-compact-medium justify-between items-center">
          <Text className="text-brand-blue font-bold text-lg" data-testid="product-title">
            {product.title}
          </Text>
          <div className="flex items-center gap-x-2 font-bold text-brand-green text-lg bg-brand-cream border-[2px] border-brand-brown px-3 py-1 rounded-full">
            {cheapestPrice && <PreviewPrice price={cheapestPrice} />}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
