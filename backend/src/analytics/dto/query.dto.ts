import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  PROMPT_MAX_LENGTH,
  PROMPT_MIN_LENGTH,
} from '../security/prompt-guard.service';

export class AnalyticsQueryDto {
  // Note: decorators run bottom-up, so the type check (IsString) runs first.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(PROMPT_MAX_LENGTH, {
    message: `prompt must be at most ${PROMPT_MAX_LENGTH} characters`,
  })
  @MinLength(PROMPT_MIN_LENGTH, {
    message: `prompt must be at least ${PROMPT_MIN_LENGTH} characters`,
  })
  @IsNotEmpty({ message: 'prompt is required' })
  @IsString({ message: 'prompt must be a string' })
  prompt!: string;
}
