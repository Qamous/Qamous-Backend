import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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

  /*
   * This is a POST request to /countries/register that creates a new country
   *
   * @param {CreateCountryDto} createCountryDto - a CreateCountryDto object that contains the
   * details of the new country
   * @returns {Promise<Country>} - the newly created Country object
   */
  @Post('register')
  async registerCountry(
    @Body() createCountryDto: CreateCountryDto,
  ): Promise<Country> {
    return this.countriesService.createCountry(createCountryDto);
  }

  @Patch(':countryCode')
  async updateCountry(
    @Param('countryCode') countryCode: string,
    @Body() updateCountryDto: CreateCountryDto,
  ): Promise<Country> {
    return this.countriesService.updateCountry(countryCode, updateCountryDto);
  }
}
