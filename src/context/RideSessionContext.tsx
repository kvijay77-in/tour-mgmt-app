import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Ride, CheckIn } from '../types/models';

type SelectedSpecial = 'NR' | 'QR' | null;

interface RideSessionState {
  currentRide: Ride | null;
  isHistorical: boolean;
  selectedStageNumber: number | null;
  selectedSpecial: SelectedSpecial;
  checkIns: CheckIn[];
  isSorted: boolean;
  autoCheckIn: boolean;
  setCurrentRide: (ride: Ride | null, historical?: boolean) => void;
  updateCurrentRide: (ride: Ride | null, historical?: boolean) => void;
  setSelectedStage: (n: number | null) => void;
  setSelectedSpecial: (s: SelectedSpecial) => void;
  setCheckIns: React.Dispatch<React.SetStateAction<CheckIn[]>>;
  toggleSort: (val?: boolean) => void;
  toggleAutoCheckIn: (val?: boolean) => void;
}

const RideSessionContext = createContext<RideSessionState | undefined>(undefined);

export function RideSessionProvider({ children }: { children: ReactNode }) {
  const [currentRide, setCurrentRideState] = useState<Ride | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [selectedStageNumber, setSelectedStageNumber] = useState<number | null>(null);
  const [selectedSpecial, setSelectedSpecial] = useState<SelectedSpecial>(null);
  const [checkIns, setCheckInsState] = useState<CheckIn[]>([]);
  const [isSorted, setIsSorted] = useState(false);
  const [autoCheckIn, setAutoCheckIn] = useState(false);

  function setCurrentRide(ride: Ride | null, historical = false) {
    setCurrentRideState(ride);
    setIsHistorical(historical);
    // reset selection when switching rides
    setSelectedStageNumber(null);
    setSelectedSpecial(null);
    setCheckInsState([]);
    setIsSorted(false);
  }

  function updateCurrentRide(ride: Ride | null, historical = false) {
    setCurrentRideState(ride);
    setIsHistorical(historical);
  }

  function setCheckIns(c: React.SetStateAction<CheckIn[]>) {
    setCheckInsState(c);
  }

  function toggleAutoCheckIn(val?: boolean) {
    if (typeof val === 'boolean') setAutoCheckIn(val);
    else setAutoCheckIn((s) => !s);
  }

  function toggleSort(val?: boolean) {
    if (typeof val === 'boolean') setIsSorted(val);
    else setIsSorted((s) => !s);
  }

  const value: RideSessionState = {
    currentRide,
    isHistorical,
    selectedStageNumber,
    selectedSpecial,
    checkIns,
    isSorted,
    autoCheckIn,
    setCurrentRide,
    updateCurrentRide,
    setSelectedStage: setSelectedStageNumber,
    setSelectedSpecial,
    setCheckIns,
    toggleSort,
    toggleAutoCheckIn,
  };

  return <RideSessionContext.Provider value={value}>{children}</RideSessionContext.Provider>;
}

export function useRideSession() {
  const ctx = useContext(RideSessionContext);
  if (!ctx) throw new Error('useRideSession must be used within RideSessionProvider');
  return ctx;
}

export default RideSessionContext;
