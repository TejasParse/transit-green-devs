import Constants from 'expo-constants';

import { AddressSuggestion, Coordinates } from '@/types/trips';

const GOOGLE_PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';

type ExpoConstantsShape = {
  expoConfig?: {
    extra?: {
      googleMapsApiKey?: string;
    };
  } | null;
};

type PlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      place?: string;
      placeId?: string;
      text?: {
        text?: string;
      };
      structuredFormat?: {
        mainText?: {
          text?: string;
        };
        secondaryText?: {
          text?: string;
        };
      };
      distanceMeters?: number;
    };
  }>;
};

function getGoogleMapsApiKey() {
  const constants = Constants as unknown as ExpoConstantsShape;
  const apiKey =
    constants.expoConfig?.extra?.googleMapsApiKey?.trim() ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing Google Maps API key. Add it to client-mobile/.env.');
  }

  return apiKey;
}

export function createAutocompleteSessionToken() {
  return `tok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.slice(0, 36);
}

type FetchPlaceSuggestionsParams = {
  input: string;
  sessionToken: string;
  currentLocation?: Coordinates | null;
};

export async function fetchPlaceSuggestions({
  input,
  sessionToken,
  currentLocation,
}: FetchPlaceSuggestionsParams) {
  const query = input.trim();

  if (query.length < 2) {
    return [];
  }

  const requestBody: Record<string, unknown> = {
    input: query,
    inputOffset: query.length,
    languageCode: 'en-US',
    regionCode: 'us',
    sessionToken,
  };

  if (currentLocation) {
    requestBody.origin = currentLocation;
    requestBody.locationBias = {
      circle: {
        center: currentLocation,
        radius: 50_000,
      },
    };
  }

  const response = await fetch(GOOGLE_PLACES_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': getGoogleMapsApiKey(),
      'X-Goog-FieldMask':
        'suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text,suggestions.placePrediction.distanceMeters',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Google Places Autocomplete failed.');
  }

  const data = (await response.json()) as PlacesAutocompleteResponse;

  return (data.suggestions ?? [])
    .flatMap((suggestion): AddressSuggestion[] => {
      const prediction = suggestion.placePrediction;

      if (!prediction?.placeId || !prediction.text?.text) {
        return [];
      }

      return [
        {
          id: prediction.placeId,
          placeId: prediction.placeId,
          placeResourceName: prediction.place,
          primaryText: prediction.structuredFormat?.mainText?.text ?? prediction.text.text,
          secondaryText: prediction.structuredFormat?.secondaryText?.text ?? '',
          fullText: prediction.text.text,
          distanceMeters: prediction.distanceMeters,
        },
      ];
    })
    .slice(0, 5);
}
