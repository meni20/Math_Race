import type { CarId } from "../types/messages";
import bmwM3CoupeUrl from "../../assets/3d-cars/1993_bmw_m3_coupe_e36.glb";
import fordGtUrl from "../../assets/3d-cars/2017_ford_gt.glb";
import mercedesAmgGt4Url from "../../assets/3d-cars/2018_mercedes-amg_gt4.glb";
import carsonAnnihilatorUrl from "../../assets/3d-cars/carson_annihilator_street_rod.glb";
import ferrariTestarossaUrl from "../../assets/3d-cars/ferrari_testarossa.glb";
import kitanoHydrosUrl from "../../assets/3d-cars/kitano_hydros_custom.glb";

export interface GarageCar {
  id: CarId;
  name: string;
  url: string;
  accentColor: string;
  bayRotation: number;
  visualRotationY?: number;
}

export const GARAGE_CARS: GarageCar[] = [
  {
    id: "bmw-m3",
    name: "BMW M3 E46",
    url: bmwM3CoupeUrl,
    accentColor: "#38bdf8",
    bayRotation: Math.PI,
    visualRotationY: Math.PI
  },
  {
    id: "ford-gt",
    name: "Ford GT",
    url: fordGtUrl,
    accentColor: "#60a5fa",
    bayRotation: Math.PI * 0.9,
    visualRotationY: 0
  },
  {
    id: "mercedes-amg",
    name: "Mercedes AMG GT4",
    url: mercedesAmgGt4Url,
    accentColor: "#8ee6c9",
    bayRotation: Math.PI * 0.78,
    visualRotationY: Math.PI
  },
  {
    id: "carson-annihilator",
    name: "Carson Annihilator",
    url: carsonAnnihilatorUrl,
    accentColor: "#f43f5e",
    bayRotation: Math.PI * 1.1,
    visualRotationY: Math.PI / 2
  },
  {
    id: "ferrari-testarossa",
    name: "Ferrari Testarossa",
    url: ferrariTestarossaUrl,
    accentColor: "#f97316",
    bayRotation: Math.PI * 1.22,
    visualRotationY: Math.PI
  },
  {
    id: "kitano-hydros",
    name: "Kitano Hydros",
    url: kitanoHydrosUrl,
    accentColor: "#a78bfa",
    bayRotation: Math.PI * 1.04,
    visualRotationY: Math.PI / 2
  }
];

export function getGarageCarById(carId: string | null | undefined) {
  return GARAGE_CARS.find((car) => car.id === carId) ?? GARAGE_CARS[0];
}
