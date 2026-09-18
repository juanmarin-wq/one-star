import HeroBanner from "@/components/home/HeroBanner"
import CategoryGrid from "@/components/home/CategoryGrid"
import FeaturedProducts from "@/components/home/FeaturedProducts"
import BrandStrip from "@/components/home/BrandStrip"
import NewArrivals from "@/components/home/NewArrivals"
import NewsletterSection from "@/components/home/NewsletterSection"
import CustomHtmlBlock from "@/components/home/CustomHtmlBlock"
import ProductCarousel from "@/components/home/ProductCarousel"
import MediaCarousel from "@/components/home/MediaCarousel"

import { getVisibleBanners } from "@/server/services/banner.service"
import { getVisibleGridBlocks } from "@/server/services/home-grid.service"
import { getStorefrontBrands } from "@/server/services/brand.service"
import { getActiveLandingSections } from "@/server/repositories/landing-section.repository"
import { getTopBanner } from "@/server/repositories/top-banner.repository"

export const dynamic = "force-dynamic";

export default async function Home() {
  // Queries independientes en paralelo; con fallbacks para que un fallo
  // puntual no tumbe toda la home.
  const [visibleBanners, gridBlocks, brandsList, sections, topBanner] = await Promise.all([
    getVisibleBanners().catch((error: unknown) => {
      console.error("[home] getVisibleBanners falló:", error)
      return []
    }),
    getVisibleGridBlocks().catch((error: unknown) => {
      console.error("[home] getVisibleGridBlocks falló:", error)
      return []
    }),
    getStorefrontBrands().catch((error: unknown) => {
      console.error("[home] getStorefrontBrands falló:", error)
      return []
    }),
    getActiveLandingSections().catch((error: unknown) => {
      console.error("[home] getActiveLandingSections falló:", error)
      return []
    }),
    getTopBanner().catch((error: unknown) => {
      console.error("[home] getTopBanner falló:", error)
      return null
    }),
  ])
  const isBannerActive = topBanner?.isActive ?? true

  return (
    <>
      {sections.map((section, index) => {
        const config = typeof section.config === 'object' && section.config !== null ? section.config as Record<string, unknown> : {}
        
        switch (section.type) {
          case "HERO":
            return <HeroBanner key={section.id} banners={visibleBanners} config={config} isFirst={index === 0} isBannerActive={isBannerActive} />
          case "CATEGORY_GRID":
            return <CategoryGrid key={section.id} blocks={gridBlocks} config={config} />
          case "FEATURED_PRODUCTS":
            return <FeaturedProducts key={section.id} config={config} />
          case "BRAND_STRIP":
            return <BrandStrip key={section.id} brands={brandsList} config={config} />
          case "NEW_ARRIVALS":
            return <NewArrivals key={section.id} config={config} />
          case "NEWSLETTER":
            return <NewsletterSection key={section.id} config={config} />
          case "CUSTOM_HTML": {
            return (
              <CustomHtmlBlock
                key={section.id}
                html={typeof config.html === 'string' ? config.html : ""}
                css={typeof config.css === 'string' ? config.css : ""}
              />
            )
          }
          case "PRODUCT_CAROUSEL":
            return <ProductCarousel key={section.id} config={config} />
          case "MEDIA_CAROUSEL":
            return <MediaCarousel key={section.id} config={config} />
          default:
            return null
        }
      })}
    </>
  )
}
