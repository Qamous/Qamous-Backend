import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CountriesService } from '../../services/countries/countries.service';
import { Country } from '../../../typeorm/entities/country';
import { CreateCountryDto } from '../../dtos/create-country.dto';

@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  /*
   * This is a GET request to /countries that returns all countries
   *
   * @returns {Promise<Country[]>} - an array of Country objects
   */
  @Get()
  async getAllCountries(): Promise<Country[]> {
    return this.countriesService.getAllCountries();
  }

  /*
   * This is a GET request to /countries/:countryCode that returns a country by its code
   *
   * @param {string} countryCode - the code of the country to return
   * @returns {Promise<Country>} - the Country object with the specified code
   */
  @Get(':countryCode')
  async getCountryByCode(
    @Param('countryCode') countryCode: string,
  ): Promise<Country> {
    return this.countriesService.getCountryByCode(countryCode);
  }

  @Post('register')
  async registerCountry(
    @Body() createCountryDto: CreateCountryDto,
  ): Promise<Country> {
    return this.countriesService.createCountry(createCountryDto);
  }
}
