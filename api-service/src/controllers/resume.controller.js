import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ResumeModel } from '../models/resume.model.js';
import { getPresignedDownloadUrl } from '../utils/s3.js';

/** GET /api/v1/resumes - the caller's own uploads. */
export const listResumes = asyncHandler(async (req, res) => {
  const resumes = await ResumeModel.listByUser({ tenantId: req.tenantId, userId: req.user.id });
  return res.status(200).json(new ApiResponse(200, { items: resumes }, 'Resumes'));
});

/**
 * GET /api/v1/resumes/:id/download
 * The bucket stays private; we hand out a short-lived presigned URL instead.
 */
export const getResumeDownloadUrl = asyncHandler(async (req, res) => {
  const resume = await ResumeModel.findById({ id: req.params.id, tenantId: req.tenantId });
  if (!resume) throw ApiError.notFound('Resume not found');
  if (resume.user_id !== req.user.id && !['owner', 'admin'].includes(req.user.role)) {
    throw ApiError.forbidden('You cannot download another user’s resume');
  }

  const url = await getPresignedDownloadUrl(resume.s3_key);
  return res
    .status(200)
    .json(new ApiResponse(200, { url, filename: resume.original_filename }, 'Presigned URL'));
});
