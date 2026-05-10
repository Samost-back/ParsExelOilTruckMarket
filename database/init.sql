CREATE TABLE public."CompanyOlivs" (
    id bigint GENERATED ALWAYS AS IDENTITY,
    name_company text NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE public.olivs (
    id bigint GENERATED ALWAYS AS IDENTITY,
    company_id bigint NOT NULL,
    name_type_oil text NOT NULL,
    name text NOT NULL,
    articul integer NOT NULL,
    packaging_volume text NOT NULL,
    description text NOT NULL,
    type_oil text,
    low_level_SAPS boolean,
    manufacturers_tolerances text,
    "ACEA" text,
    "API" text,
    color_liquid text,
    "ISO_VG_viscosity_grade" text,
    "standart_G" text,
    "DOT" text,
    viscosity_SAE text,
    quantity integer,
    PRIMARY KEY (id),
    UNIQUE (company_id, articul),
    CONSTRAINT company_fkey
        FOREIGN KEY (company_id)
        REFERENCES public."CompanyOlivs"(id)
);

CREATE TABLE public.oils_price (
    id bigint GENERATED ALWAYS AS IDENTITY,
    oils_id bigint NOT NULL,
    price integer NOT NULL,
    valid_from timestamp without time zone DEFAULT now() NOT NULL,
    valid_to timestamp without time zone,
    PRIMARY KEY (id),
    CONSTRAINT oils_id_fkey
        FOREIGN KEY (oils_id)
        REFERENCES public.olivs(id)
);