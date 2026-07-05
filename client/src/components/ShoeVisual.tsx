// Professional shoe iconography. Models store their visual in `image` as either
// an icon key ('icon:sneaker'), an uploaded data-URL photo, or a legacy emoji
// (rendered as text for backwards compatibility). Icons follow the lucide style:
// 24px stroke outlines on currentColor.

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    className, "aria-hidden": true,
  };
}

export function SneakerIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 18v-8.8c0-.7.5-1.2 1.1-1.2h1.3c.9 0 1.7.4 2.2 1.2l1.1 1.6c.7 1 1.7 1.8 2.9 2.1l5.6 1.7c1.8.5 3.8 1.6 3.8 3.4H3Z" />
      <path d="M3 15.4h17.4" />
      <path d="m9.5 11.4 1.6-1.6" />
      <path d="m11.9 13 1.6-1.6" />
    </svg>
  );
}

export function BootIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M7.5 3.5h6v7.2c0 .8.5 1.5 1.3 1.8l3.9 1.5c1.1.4 1.8 1.5 1.8 2.7V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.8c0-1 .6-1.9 1.5-2.3l1.2-.5c.5-.2.8-.7.8-1.3V3.5Z" />
      <path d="M7.5 6.5h6" />
      <path d="M7.5 9.5h6" />
      <path d="M4 16.9h16.5" />
    </svg>
  );
}

export function SandalIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.5" y="15.5" width="19" height="4" rx="2" />
      <path d="M7.5 15.5 12 10.2l4.5 5.3" />
      <path d="M12 10.2V8.6" />
    </svg>
  );
}

export function HeelIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2.5 17.5c4.5 0 7.3-1.6 9.3-4.6s4.7-5.9 8.7-6.4c.6-.1 1 .4 1 1v1.7c0 .5-.3 1-.8 1.2-1.6.7-2.2 1.8-2.2 3.6v3.5h-2.6v-2.3c0-1-.8-1.8-1.8-1.8-2.5 0-4.6 1.9-5.1 4.1H2.5Z" />
    </svg>
  );
}

export function OxfordIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2.5 17.5v-2.7c0-1.3.9-2.3 2.1-2.5l1.7-.3c.8-.2 1.4-.9 1.4-1.7V9c0-.6.4-1 1-1h1c.9 0 1.7.4 2.2 1.2l1 1.5c.7 1 1.7 1.7 2.8 2l4.7 1.4c1.1.3 1.8 1.3 1.8 2.4v1a1 1 0 0 1-1 1H2.5Z" />
      <path d="M16.6 13c1.4.9 2.3 2.4 2.5 4.5" />
    </svg>
  );
}

export function SlipperIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 17.5c0-4.6 2.8-8 7-8 3.4 0 5.9 2.2 6.8 5.5l.7 2.5" />
      <path d="M3 17.5h18" />
      <path d="M6.6 13.2c1.7 1.5 4.5 1.7 6.6.6" />
    </svg>
  );
}

export const SHOE_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  sneaker: SneakerIcon,
  boot: BootIcon,
  sandal: SandalIcon,
  heel: HeelIcon,
  oxford: OxfordIcon,
  slipper: SlipperIcon,
};

export const SHOE_ICON_KEYS = Object.keys(SHOE_ICONS);

/** Renders a model's visual: uploaded photo, icon key, legacy emoji, or default. */
export function ShoeVisual({ image, size = 26, className = "" }: {
  image: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (image && image.startsWith("data:")) {
    return <img src={image} alt="" className={`shoe-photo ${className}`} />;
  }
  if (image && image.startsWith("icon:")) {
    const Icon = SHOE_ICONS[image.slice(5)] ?? SneakerIcon;
    return <Icon size={size} className={className} />;
  }
  if (image) {
    // Legacy emoji / free text from before the icon picker.
    return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{image}</span>;
  }
  return <SneakerIcon size={size} className={className} />;
}
