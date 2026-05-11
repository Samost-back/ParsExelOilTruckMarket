CREATE TABLE public."company_olivs" (
    id bigint GENERATED ALWAYS AS IDENTITY,
    name_company text NOT NULL,
    UNIQUE (name_company),
    PRIMARY KEY (id)
);

CREATE TABLE public.olivs (
    id bigint GENERATED ALWAYS AS IDENTITY,
    company_id bigint NOT NULL,
    name_type_oil text NOT NULL,
    name text NOT NULL,
    articul integer NOT NULL,
    packaging_volume numeric(5,1) NOT NULL,
    description text NOT NULL,
    type_oil text,
    low_level_saps boolean,
    manufacturers_tolerances text,
    "acea" text,
    "api" text,
    color_liquid text,
    "iso_vg_viscosity_grade" text,
    "standart_g" text,
    "dot" text,
    viscosity_sae text,
    quantity integer,
    PRIMARY KEY (id),
    UNIQUE (company_id, articul),
    CONSTRAINT company_fkey
        FOREIGN KEY (company_id)
        REFERENCES public."company_olivs"(id)
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