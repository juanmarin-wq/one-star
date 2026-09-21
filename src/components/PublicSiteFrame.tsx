"use client"

import type { ComponentProps, ReactNode } from "react"
import { usePathname } from "next/navigation"

import Header from "@/components/Header"
import ChatWidget from "@/components/chat/ChatWidget"
import { isAdminPathname } from "@/lib/public-site-route"

type PublicSiteFrameProps = ComponentProps<typeof Header> & {
  children: ReactNode
}

export default function PublicSiteFrame({ children, ...headerProps }: PublicSiteFrameProps) {
  const pathname = usePathname()

  if (isAdminPathname(pathname)) {
    return <div className="flex-1">{children}</div>
  }

  const bannerIsVisible = !headerProps.banner || headerProps.banner.isActive
  const spacerClass = bannerIsVisible
    ? "h-[88px] md:h-[96px]"
    : "h-[56px] md:h-[64px]"

  return (
    <>
      <Header {...headerProps} />
      <div aria-hidden="true" className={spacerClass} data-testid="public-site-spacer" />
      <main className="flex-1">{children}</main>
      <ChatWidget />
    </>
  )
}
