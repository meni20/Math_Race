import { useId } from "react";
import type { CarId } from "../../game/types/messages";
import { getGarageCarById } from "../../game/utils/carCatalog";

interface TeacherCarIconProps {
  carId?: CarId;
  className?: string;
  label?: string;
}

export function getCarDisplayInfo(carId?: CarId) {
  const car = getGarageCarById(carId);
  return {
    carId: car.id,
    carName: car.name,
    color: car.accentColor
  };
}

export function TeacherCarIcon({ carId, className = "", label }: TeacherCarIconProps) {
  const uniqueId = useId().replace(/:/g, "");
  const car = getCarDisplayInfo(carId);
  const title = label ?? car.carName;
  const gradientId = `teacher-car-${car.carId}-${uniqueId}`;

  return (
    <svg
      viewBox="0 0 96 44"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="36%" stopColor={car.color} />
          <stop offset="100%" stopColor={car.color} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <path
        d="M18 29c1.8-8 7.1-15 15.7-16.7l22.6-4.5c8.3-1.6 16.4 2.8 19.4 10.7L82 20c5.6 1.3 9.5 5.7 9.5 10.8v2.8H5.5v-2.3c0-4.7 5.1-8.5 12.5-9.1Z"
        fill={`url(#${gradientId})`}
        stroke="rgba(255,255,255,0.78)"
        strokeWidth="2.2"
      />
      <path d="M33 14.8h16l-2.6 9.4H24.8c1.4-4.2 4.1-7.4 8.2-9.4Z" fill="rgba(15,23,42,0.72)" />
      <path d="M53.5 14.8h11.9c3.5 1.1 6.2 3.6 7.9 7.1l-21.6 2.3Z" fill="rgba(15,23,42,0.72)" />
      <circle cx="24" cy="33.5" r="7.5" fill="#0f172a" stroke="rgba(255,255,255,0.8)" strokeWidth="2" />
      <circle cx="72" cy="33.5" r="7.5" fill="#0f172a" stroke="rgba(255,255,255,0.8)" strokeWidth="2" />
      <circle cx="24" cy="33.5" r="2.6" fill="rgba(255,255,255,0.85)" />
      <circle cx="72" cy="33.5" r="2.6" fill="rgba(255,255,255,0.85)" />
      <path d="M8.5 29.2h8.4M80.4 24.3h6.8" stroke="rgba(255,255,255,0.78)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
