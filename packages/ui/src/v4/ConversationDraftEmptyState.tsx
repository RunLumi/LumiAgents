// Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.
/**
 * 草稿态空态问候：时间问候语 + ZCode Logo。
 * 自旧版 ChatView/ChatViewEmptyState.tsx 恢复（该组件随旧 ChatView 删除，
 * i18n key `chat.empty.greeting.*` 一直保留）；边界时刻自动换档逻辑保真。
 * 手机远控复用同一组件，但继续保留 20px 紧凑标题；桌面草稿首页才按标题自身宽度适配。
 */
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { logger } from "@/logger.js";

const GREETING_BOUNDARY_HOURS = [5, 9, 12, 14, 18, 23] as const;
const GREETING_MIN_FONT_SIZE_PX = 20;
const GREETING_MAX_FONT_SIZE_PX = 30;

export type ChatEmptyGreetingMessageId =
  | "chat.empty.greeting.morningEarly"
  | "chat.empty.greeting.morning"
  | "chat.empty.greeting.noon"
  | "chat.empty.greeting.afternoon"
  | "chat.empty.greeting.evening"
  | "chat.empty.greeting.lateNight";

export function getChatEmptyGreetingMessageId(date: Date = new Date()): ChatEmptyGreetingMessageId {
  const hour = date.getHours();

  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "chat.empty.greeting.morning";
  if (hour >= 12 && hour < 14) return "chat.empty.greeting.noon";
  if (hour >= 14 && hour < 18) return "chat.empty.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "chat.empty.greeting.evening";

  return "chat.empty.greeting.lateNight";
}

export function getNextChatEmptyGreetingDelayMs(date: Date = new Date()) {
  const candidates = GREETING_BOUNDARY_HOURS.map((hour) => {
    const boundary = new Date(date);
    boundary.setHours(hour, 0, 0, 0);
    return boundary;
  });
  const tomorrowFirstBoundary = new Date(date);
  tomorrowFirstBoundary.setDate(tomorrowFirstBoundary.getDate() + 1);
  tomorrowFirstBoundary.setHours(GREETING_BOUNDARY_HOURS[0], 0, 0, 0);

  const nextBoundary =
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ?? tomorrowFirstBoundary;

  return Math.max(1, nextBoundary.getTime() - date.getTime());
}

export function resolveGreetingFontSizePx({
  availableWidthPx,
  naturalTextWidthPx,
  compactForRemoteControl = false,
}: {
  availableWidthPx: number;
  naturalTextWidthPx: number;
  compactForRemoteControl?: boolean;
}) {
  if (compactForRemoteControl) {
    return GREETING_MIN_FONT_SIZE_PX;
  }
  if (
    !Number.isFinite(availableWidthPx) ||
    !Number.isFinite(naturalTextWidthPx) ||
    availableWidthPx <= 0 ||
    naturalTextWidthPx <= 0 ||
    availableWidthPx >= naturalTextWidthPx
  ) {
    return GREETING_MAX_FONT_SIZE_PX;
  }

  return Math.max(
    GREETING_MIN_FONT_SIZE_PX,
    Math.min(
      GREETING_MAX_FONT_SIZE_PX,
      Math.floor(GREETING_MAX_FONT_SIZE_PX * (availableWidthPx / naturalTextWidthPx)),
    ),
  );
}

export function ConversationDraftEmptyState({
  className,
  compactForRemoteControl = false,
}: {
  className?: string;
  compactForRemoteControl?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const [greetingDate, setGreetingDate] = useState(() => new Date());
  const [greetingFontSizePx, setGreetingFontSizePx] = useState(GREETING_MAX_FONT_SIZE_PX);
  const greetingContainerRef = useRef<HTMLParagraphElement | null>(null);
  const greetingMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const greeting = intl.formatMessage({
    id: isOfficeMode ? "chat.empty.greeting.office" : getChatEmptyGreetingMessageId(greetingDate),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setGreetingDate(new Date());
    }, getNextChatEmptyGreetingDelayMs(greetingDate));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [greetingDate]);

  useLayoutEffect(() => {
    if (compactForRemoteControl) {
      setGreetingFontSizePx(GREETING_MIN_FONT_SIZE_PX);
      return;
    }
    const container = greetingContainerRef.current;
    const measurement = greetingMeasurementRef.current;
    if (!container || !measurement) {
      return;
    }

    let frameId: number | null = null;
    const measure = () => {
      frameId = null;
      const containerStyle = window.getComputedStyle(container);
      const horizontalPaddingPx =
        Number.parseFloat(containerStyle.paddingLeft) +
        Number.parseFloat(containerStyle.paddingRight);
      const availableWidthPx = Math.max(
        0,
        container.getBoundingClientRect().width - horizontalPaddingPx,
      );
      const naturalTextWidthPx = measurement.getBoundingClientRect().width;
      const nextFontSizePx = resolveGreetingFontSizePx({
        availableWidthPx,
        naturalTextWidthPx,
      });

      setGreetingFontSizePx((currentFontSizePx) => {
        if (currentFontSizePx === nextFontSizePx) {
          return currentFontSizePx;
        }
        logger.debug("[v4-draft-greeting] 标题自身可用宽度变化，更新字号", {
          availableWidthPx: Math.round(availableWidthPx),
          naturalTextWidthPx: Math.round(naturalTextWidthPx),
          previousFontSizePx: currentFontSizePx,
          nextFontSizePx,
        });
        return nextFontSizePx;
      });
    };
    const scheduleMeasure = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(measure);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleMeasure);
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        window.removeEventListener("resize", scheduleMeasure);
      };
    }

    // 标题字号曾直接绑定整个视口宽度，最小窗口里文字两侧仍有大量空间却被
    // 强制缩到 20px。分别观察标题容器和 30px 原始文案，只在两者真实相撞时缩小。
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    observer.observe(measurement);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [compactForRemoteControl, greeting]);

  return (
    <div
      className={cn(
        "relative mb-10 flex w-full max-w-2xl flex-col items-center justify-center gap-6 text-foreground sm:mb-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 aspect-[5/4] w-[min(72vw,25rem)] -mt-10",
          "-translate-x-1/2 -translate-y-1/2 text-foreground-subtlest",
        )}
      >
        <ZCodeEmptyStateLogo className="h-full w-full" />
      </div>
      <p
        ref={greetingContainerRef}
        data-v4-draft-greeting="true"
        style={
          {
            "--v4-draft-greeting-font-size": `${greetingFontSizePx}px`,
          } as CSSProperties
        }
        className={cn(
          "relative z-10 w-full px-4 text-center font-medium text-foreground",
          compactForRemoteControl
            ? "text-xl/[1.2]"
            : "text-[length:var(--v4-draft-greeting-font-size)]/[1.2]",
        )}
      >
        <span
          ref={greetingMeasurementRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute whitespace-nowrap text-3xl/[1.2]"
        >
          {greeting}
        </span>
        <span>{greeting}</span>
      </p>
    </div>
  );
}

function ZCodeEmptyStateLogo({ className }: { className?: string }) {
  return (
    <>
      {/* 单一 Lumi 折叠 L 线框水印：Lumi 只有浅色主题，不再保留上游“深色专用渐变资源”的第二套 Logo。 */}
      <svg
        aria-hidden="true"
        className={cn(
          className,
          "opacity-70 dark:hidden",
          "[-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]",
          "[mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[mask-repeat:no-repeat] [mask-size:100%_100%]",
        )}
        width="400"
        height="320"
        viewBox="0 0 400 320"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Lumi 官方折叠 L 几何（brand/lumi-mark.svg，来自 RunLumi/brand.runlumi）的线框水印。 */}
        <g transform="translate(97 31) scale(0.65)">
          <path
            d="M99.4558 0C99.4558 99.4558 99.3907 198.912 99.3257 298.302C66.2171 331.151 33.1086 363.934 0 396.782C0 297.327 0 197.871 0 98.4801C33.1086 65.6317 66.2822 32.8484 99.3907 0H99.4558Z"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
          />
          <path
            d="M126.71 298.302C189.935 298.302 253.16 298.302 316.45 298.302C283.406 331.086 250.363 363.934 217.385 396.717C154.355 396.717 91.3248 396.717 28.2949 396.717C61.1433 363.869 93.9266 331.086 126.775 298.237L126.71 298.302Z"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
          />
        </g>
      </svg>
    </>
  );
}
