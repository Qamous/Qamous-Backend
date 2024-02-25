import { Controller, Get, Param } from '@nestjs/common';
import { CountriesService } from '../../services/countries/countries.service';
import { Country } from '../../../typeorm/entities/country';

@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  async getAllCountries(): Promise<Country[]> {
    return this.countriesService.getAllCountries();
  }

  @Get(':countryCode')
  async getCountryByCode(
    @Param('countryCode') countryCode: string,
  ): Promise<Country> {
    return this.countriesService.getCountryByCode(countryCode);
  }
}
