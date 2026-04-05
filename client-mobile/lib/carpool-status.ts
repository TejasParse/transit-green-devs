import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { CarpoolTripRecord } from '@/types/trips';

export type CarpoolRoleStatus = {
  badge: string;
  title: string;
  description: string;
  tone: 'accent' | 'warning' | 'success' | 'muted';
  icon: keyof typeof MaterialIcons.glyphMap;
};

function getLiveRiderName(trip: CarpoolTripRecord) {
  return (
    trip.liveStatus?.activeRiderName ??
    (trip.requests ?? []).find((request) => request.id === trip.liveStatus?.activeRequestId)?.riderName ??
    'your rider'
  );
}

export function getCarpoolRoleStatus(trip: CarpoolTripRecord, currentUserId: number): CarpoolRoleStatus {
  const role = trip.currentUserRole ?? (trip.driverId === currentUserId ? 'driver' : 'rider');
  const requestStatus = trip.currentUserRequest?.status ?? null;
  const liveStage = trip.liveStatus?.stage ?? null;
  const liveRiderName = getLiveRiderName(trip);
  const isLiveRider = trip.liveStatus?.activeRiderId === currentUserId;

  if (trip.status === 'completed' || trip.status === 'ended') {
    return {
      badge: 'Completed',
      title: 'Shared ride complete',
      description: 'Shared savings, points, and trip history have been finalized for this carpool.',
      tone: 'success',
      icon: 'check-circle',
    };
  }

  if (trip.status === 'cancelled') {
    return {
      badge: 'Cancelled',
      title: 'Carpool cancelled',
      description:
        role === 'driver'
          ? 'This hosted carpool is closed and no longer accepting riders.'
          : 'The driver cancelled this shared ride before it completed.',
      tone: 'warning',
      icon: 'cancel',
    };
  }

  if (role === 'driver') {
    if (trip.status === 'draft') {
      return {
        badge: 'Draft',
        title: 'Draft offer',
        description: 'Finish the carpool setup to start receiving seat requests.',
        tone: 'muted',
        icon: 'edit',
      };
    }

    if (trip.status === 'active') {
      if (liveStage === 'driver_to_pickup') {
        return {
          badge: 'Live',
          title: 'Heading to pickup',
          description: `Drive to ${liveRiderName}'s pickup point. Rider and driver devices stay synced from here.`,
          tone: 'accent',
          icon: 'person-pin-circle',
        };
      }

      if (liveStage === 'rider_onboard') {
        return {
          badge: 'Live',
          title: 'Rider onboard',
          description: `Take ${liveRiderName} to the drop-off point before continuing your route.`,
          tone: 'accent',
          icon: 'groups',
        };
      }

      if (liveStage === 'driver_to_destination') {
        return {
          badge: 'Live',
          title: 'Final leg',
          description: 'The rider has been dropped off. Continue to your original destination.',
          tone: 'accent',
          icon: 'route',
        };
      }

      return {
        badge: 'Live',
        title: 'Shared ride active',
        description: 'Your carpool is running live right now and riders can follow the trip on their device.',
        tone: 'accent',
        icon: 'navigation',
      };
    }

    if (trip.pendingRequestCount > 0 && trip.acceptedRiders === 0) {
      return {
        badge: 'Requests',
        title: 'Review incoming riders',
        description: 'A rider is waiting for your decision before the shared trip can be confirmed.',
        tone: 'warning',
        icon: 'mark-email-unread',
      };
    }

    if (trip.acceptedRiders > 0 || liveStage === 'ready_to_start') {
      return {
        badge: 'Ready',
        title: 'Ready to start',
        description: `An accepted rider is waiting. Start the shared ride when you are ready to drive to pickup.`,
        tone: 'accent',
        icon: 'play-circle',
      };
    }

    return {
      badge: 'Open',
      title: 'Waiting for riders',
      description: 'Your offer is published. Riders can request seats from the carpool tab.',
      tone: 'muted',
      icon: 'groups',
    };
  }

  if (requestStatus === 'pending') {
    return {
      badge: 'Pending',
      title: 'Request pending',
      description: `Waiting for ${trip.driverName} to accept your carpool request.`,
      tone: 'warning',
      icon: 'hourglass-top',
    };
  }

  if (requestStatus === 'rejected') {
    return {
      badge: 'Declined',
      title: 'Request declined',
      description: 'This driver declined your request, so this carpool is no longer available to join.',
      tone: 'warning',
      icon: 'person-off',
    };
  }

  if (requestStatus === 'cancelled_by_rider') {
    return {
      badge: 'Cancelled',
      title: 'Request cancelled',
      description: 'You cancelled your seat request for this carpool.',
      tone: 'muted',
      icon: 'cancel',
    };
  }

  if (requestStatus === 'expired') {
    return {
      badge: 'Expired',
      title: 'Request expired',
      description: 'This carpool request expired before the driver accepted it.',
      tone: 'warning',
      icon: 'schedule',
    };
  }

  if (trip.status === 'active') {
    if (liveStage === 'driver_to_pickup') {
      return {
        badge: 'Live',
        title: isLiveRider ? 'Driver heading to pickup' : 'Another pickup in progress',
        description: isLiveRider
          ? `${trip.driverName} is driving to your pickup point right now.`
          : 'The driver is handling another rider stop before your next status update.',
        tone: 'accent',
        icon: 'directions-car',
      };
    }

    if (liveStage === 'rider_onboard') {
      return {
        badge: 'Live',
        title: isLiveRider ? 'You are onboard' : 'Shared ride moving',
        description: isLiveRider
          ? 'You are in the car now. The driver is heading to your drop-off point.'
          : 'The driver is currently taking a rider to their drop-off point.',
        tone: 'accent',
        icon: 'groups',
      };
    }

    if (liveStage === 'driver_to_destination') {
      return {
        badge: 'Live',
        title: isLiveRider ? 'You were dropped off' : 'Driver finishing route',
        description: isLiveRider
          ? 'Your stop is complete. The driver is finishing the last leg to the original destination.'
          : 'The rider stop is complete and the driver is finishing the route.',
        tone: 'success',
        icon: 'flag',
      };
    }

    return {
      badge: 'Live',
      title: 'Shared ride active',
      description: 'This carpool is live and your rider status will stay synced with the driver.',
      tone: 'accent',
      icon: 'navigation',
    };
  }

  if (requestStatus === 'accepted' || liveStage === 'ready_to_start') {
    return {
      badge: 'Confirmed',
      title: 'Seat confirmed',
      description: `Your seat is locked in. ${trip.driverName} still needs to start the carpool.`,
      tone: 'accent',
      icon: 'verified-user',
    };
  }

  return {
    badge: 'Open',
    title: 'Carpool available',
    description: 'This carpool is available to join if you want to request a seat.',
    tone: 'muted',
    icon: 'groups',
  };
}
