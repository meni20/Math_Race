import type { CarId } from "../types/messages";
import { GARAGE_CARS } from "./carCatalog";

export const CAR_METADATA = Object.fromEntries(
  GARAGE_CARS.map((car) => [car.id, { name: car.name, accentColor: car.accentColor }])
) as Record<CarId, { name: string; accentColor: string }>;

export function getCarMetadata(carId: CarId | undefined) {
  return CAR_METADATA[carId ?? "bmw-m3"] ?? CAR_METADATA["bmw-m3"];
}
