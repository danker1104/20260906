import { z } from 'zod';
import {
  editionKinds,
  nlApiModes,
  mangaClassifications,
  publicationErrorCodes,
  publicationQueryTypes,
  publicationRelevanceBands,
  volumeStatuses,
} from './publication-types';

export const publicationVolumeSchema = z.object({
  recordId: z.string().min(1),
  title: z.string().min(1),
  seriesTitle: z.string().min(1).nullable().optional(),
  seriesNumber: z.string().min(1).nullable().optional(),
  volumeNumber: z.number().int().nullable(),
  volumeLabel: z.string().min(1).nullable(),
  isbn: z.string().min(1).nullable(),
  isbnSource: z.enum(['EA_ISBN', 'SET_ISBN']).nullable().optional(),
  author: z.string().min(1).nullable(),
  publisher: z.string().min(1).nullable(),
  editionStatement: z.string().min(1).nullable().optional(),
  form: z.string().min(1).nullable().optional(),
  ebookYn: z.enum(['Y', 'N']).nullable().optional(),
  expectedPublicationDate: z.string().min(1).nullable(),
  inputDate: z.string().min(1).nullable().optional(),
  updateDate: z.string().min(1).nullable().optional(),
  relatedIsbn: z.string().min(1).nullable().optional(),
  status: z.enum(volumeStatuses),
  edition: z.enum(editionKinds),
  coverUrl: z.string().min(1).nullable(),
  productUrl: z.string().min(1).nullable(),
  isMock: z.boolean(),
});

export const publicationWorkSchema = z.object({
  workKey: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1).nullable(),
  publisher: z.string().min(1).nullable(),
  volumes: z.array(publicationVolumeSchema).min(1),
  mangaClassification: z.enum(mangaClassifications),
  relevanceBand: z.enum(publicationRelevanceBands),
});

export const publicationSearchResponseSchema = z.object({
  query: z.string().min(1),
  queryType: z.enum(publicationQueryTypes),
  mode: z.enum(nlApiModes),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
  works: z.array(publicationWorkSchema),
  ungroupedVolumes: z.array(publicationVolumeSchema),
});

export const publicationErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(publicationErrorCodes),
    message: z.string().min(1),
    requestId: z.string().uuid(),
  }),
});

export const yes24LookupResponseSchema = z.object({
  mode: z.enum(nlApiModes),
  matched: z.boolean(),
  itemId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  coverUrl: z.string().min(1).optional(),
  productUrl: z.string().min(1).optional(),
  publisher: z.string().min(1).optional(),
});

export type PublicationSearchResponseInput = z.infer<typeof publicationSearchResponseSchema>;
export type PublicationErrorResponseInput = z.infer<typeof publicationErrorResponseSchema>;
export type Yes24LookupResponseInput = z.infer<typeof yes24LookupResponseSchema>;
